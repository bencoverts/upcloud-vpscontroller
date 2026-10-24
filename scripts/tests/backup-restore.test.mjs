import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backupScript = path.join(rootDir, 'scripts', 'backup.mjs');
const restoreScript = path.join(rootDir, 'scripts', 'restore.mjs');
const databaseUrl = 'postgresql://panel:secret-password@db.example.test:5432/cerdasnet';

const programs = {
  pg_dump: `
    if (process.env.FAKE_PG_DUMP_FAIL) {
      process.stderr.write('connection failed for ' + process.env.DATABASE_URL);
      process.exit(1);
    }
    process.stdout.write('PGDMP-node-test-backup');
  `,
  pg_restore: `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (!args.includes('--list') && process.env.FAKE_RESTORE_MARKER) {
      fs.writeFileSync(process.env.FAKE_RESTORE_MARKER, args.join(' '));
    }
    if (args.includes('--list') && args[args.length - 1] !== '--list' && !fs.existsSync(args[args.length - 1])) {
      process.stderr.write('archive missing');
      process.exit(1);
    }
  `,
  pg_isready: '',
  psql: `
    const fs = require('node:fs');
    if (process.env.FAKE_SCHEMA_MARKER) fs.writeFileSync(process.env.FAKE_SCHEMA_MARKER, process.argv.slice(2).join(' '));
  `,
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cerdasnet-node-scripts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  const backupDir = path.join(directory, 'backups');
  await mkdir(bin);
  for (const [name, source] of Object.entries(programs)) {
    const executable = path.join(bin, name);
    await writeFile(executable, `#!/usr/bin/env node\n${source}\n`);
    await chmod(executable, 0o755);
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    COMPOSE: '0',
    DATABASE_URL: databaseUrl,
    BACKUP_DIR: backupDir,
  };
  delete env.APP_STOPPED;
  delete env.RESTORE_CONFIRM;
  delete env.FAKE_PG_DUMP_FAIL;
  delete env.FAKE_RESTORE_MARKER;
  delete env.FAKE_SCHEMA_MARKER;
  return { directory, backupDir, env };
}

async function backupFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.dump')).sort();
}

test('Node backup writes a verified dump, checksum, and restrictive permissions', async (t) => {
  const { backupDir, env } = await fixture(t);
  const result = await execFileAsync(process.execPath, [backupScript], { env });
  assert.match(result.stdout, /Backup created and catalog verified/);
  const files = await backupFiles(backupDir);
  assert.equal(files.length, 1);
  const archive = path.join(backupDir, files[0]);
  assert.equal(await readFile(archive, 'utf8'), 'PGDMP-node-test-backup');
  const checksum = await readFile(`${archive}.sha256`, 'utf8');
  assert.match(checksum, /^[a-f0-9]{64} {2}/);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  assert.equal((await stat(`${archive}.sha256`)).mode & 0o777, 0o600);
});

test('Node restore enforces guards, creates a safety backup, and verifies schema', async (t) => {
  const { directory, backupDir, env } = await fixture(t);
  await execFileAsync(process.execPath, [backupScript], { env });
  const [first] = await backupFiles(backupDir);
  const archive = path.join(backupDir, first);
  const restoreMarker = path.join(directory, 'restore-marker.txt');
  const schemaMarker = path.join(directory, 'schema-marker.txt');
  const guardedEnv = {
    ...env,
    APP_STOPPED: 'YES',
    RESTORE_CONFIRM: 'YES',
    FAKE_RESTORE_MARKER: restoreMarker,
    FAKE_SCHEMA_MARKER: schemaMarker,
  };
  const result = await execFileAsync(process.execPath, [restoreScript, archive], { env: guardedEnv });
  assert.match(result.stdout, /pre-restore safety backup/);
  assert.match(result.stdout, /Restore completed and required tables verified/);
  assert.equal((await backupFiles(backupDir)).length, 2);
  assert.match(await readFile(restoreMarker, 'utf8'), /--single-transaction/);
  assert.match(await readFile(schemaMarker, 'utf8'), /SELECT COUNT\(\*\) FROM servers/);
});

test('Node restore refuses to run without explicit confirmations', async (t) => {
  const { directory, env } = await fixture(t);
  const archive = path.join(directory, 'input.dump');
  await writeFile(archive, 'PGDMP-test');
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env }),
    (error) => {
      assert.match(error.stderr, /RESTORE_CONFIRM=YES/);
      return true;
    },
  );
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env: { ...env, RESTORE_CONFIRM: 'YES' } }),
    (error) => {
      assert.match(error.stderr, /APP_STOPPED=YES/);
      return true;
    },
  );
});

test('Node tooling redacts database credentials from child-process errors', async (t) => {
  const { env } = await fixture(t);
  env.FAKE_PG_DUMP_FAIL = '1';
  await assert.rejects(
    execFileAsync(process.execPath, [backupScript], { env }),
    (error) => {
      assert.doesNotMatch(error.stderr, /secret-password/);
      assert.doesNotMatch(error.stderr, /db\.example\.test/);
      assert.match(error.stderr, /\[redacted\]/);
      return true;
    },
  );
});
