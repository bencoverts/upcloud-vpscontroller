import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const useCompose = process.env.COMPOSE === '1';
const schemaCheck = 'SELECT COUNT(*) FROM servers; SELECT COUNT(*) FROM api_tokens; SELECT COUNT(*) FROM schema_migrations;';
const secretNames = ['DATABASE_URL', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'TOKEN_ENCRYPTION_KEY', 'UPCLOUD_TEST_TOKEN'];

export function redact(value) {
  let text = String(value);
  for (const name of secretNames) {
    const secret = process.env[name];
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/((?:password|passwd|pwd)=)[^\s&]+/gi, '$1[redacted]');
}

export function assertDatabaseConfigured() {
  if (!useCompose && !process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL, or use COMPOSE=1 with the Compose db service.');
  }
}

export function run(command, args, options = {}) {
  const { inputFile, outputFile, capture = false, showStdout = false } = options;
  return new Promise((resolve, reject) => {
    let inputFd;
    let outputFd;
    let done = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const closeDescriptors = () => {
      if (inputFd !== undefined) fs.closeSync(inputFd);
      if (outputFd !== undefined) fs.closeSync(outputFd);
      inputFd = undefined;
      outputFd = undefined;
    };
    const finish = (error, value) => {
      if (done) return;
      done = true;
      closeDescriptors();
      if (error) reject(error);
      else resolve(value ?? '');
    };

    let child;
    try {
      if (inputFile) inputFd = fs.openSync(inputFile, 'r');
      if (outputFile) outputFd = fs.openSync(outputFile, 'w', 0o600);
      child = spawn(command, args, {
        cwd: command === 'docker' ? ROOT_DIR : undefined,
        env: process.env,
        shell: false,
        stdio: [inputFd ?? 'ignore', outputFd ?? (capture || showStdout ? 'pipe' : 'ignore'), 'pipe'],
      });
    } catch {
      finish(new Error(`Unable to start ${command}. Check the required executable and file permissions.`));
      return;
    }

    child.stdout?.on('data', (chunk) => {
      if (showStdout) process.stdout.write(chunk);
      if (capture) {
        stdoutSize += chunk.length;
        if (stdoutSize > 1024 * 1024) {
          child.kill('SIGTERM');
          finish(new Error(`${command} produced unexpectedly large output.`));
          return;
        }
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderrSize >= 65_536) return;
      const remaining = 65_536 - stderrSize;
      stderrChunks.push(chunk.subarray(0, remaining));
      stderrSize += Math.min(chunk.length, remaining);
    });
    child.on('error', () => {
      finish(new Error(`Unable to execute ${command}. Install the required executable and retry.`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish(null, capture ? Buffer.concat(stdoutChunks).toString('utf8') : '');
        return;
      }
      const detail = redact(Buffer.concat(stderrChunks).toString('utf8').trim());
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      finish(new Error(`${command} failed with ${reason}.${detail ? `\n${detail}` : ''}`));
    });
  });
}

let composeInfoPromise;
async function composeDatabase() {
  if (!composeInfoPromise) {
    composeInfoPromise = Promise.all([
      run('docker', ['compose', 'exec', '-T', 'db', 'printenv', 'POSTGRES_USER'], { capture: true }),
      run('docker', ['compose', 'exec', '-T', 'db', 'printenv', 'POSTGRES_DB'], { capture: true }),
    ]).then(([user, database]) => {
      const result = { user: user.trim(), database: database.trim() };
      if (!result.user || !result.database) throw new Error('Compose db credentials/database name are unavailable.');
      return result;
    });
  }
  return composeInfoPromise;
}
async function composePg(tool, args, options = {}) {
  const { user, database } = await composeDatabase();
  return run('docker', ['compose', 'exec', '-T', 'db', tool, '-U', user, '-d', database, ...args], options);
}

export async function dumpDatabase(outputFile) {
  assertDatabaseConfigured();
  if (useCompose) return composePg('pg_dump', ['-Fc'], { outputFile });
  return run('pg_dump', [`--dbname=${process.env.DATABASE_URL}`, '--format=custom', '--no-owner', '--no-privileges'], { outputFile });
}

export async function verifyArchive(archive) {
  if (useCompose) return run('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--list'], { inputFile: archive });
  return run('pg_restore', ['--list', archive]);
}

export async function assertDatabaseReady() {
  assertDatabaseConfigured();
  if (useCompose) return composePg('pg_isready', []);
  return run('pg_isready', [`--dbname=${process.env.DATABASE_URL}`]);
}

export async function restoreArchive(archive) {
  const args = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error'];
  if (useCompose) return composePg('pg_restore', args, { inputFile: archive });
  return run('pg_restore', [`--dbname=${process.env.DATABASE_URL}`, ...args, archive]);
}

export async function verifyRestoredSchema() {
  if (useCompose) return composePg('psql', ['-v', 'ON_ERROR_STOP=1', '-c', schemaCheck]);
  return run('psql', [`--dbname=${process.env.DATABASE_URL}`, '-v', 'ON_ERROR_STOP=1', '-c', schemaCheck]);
}
