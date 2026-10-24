import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backupScript = path.join(rootDir, 'scripts', 'backup.mjs');
const restoreScript = path.join(rootDir, 'scripts', 'restore.mjs');
const collections = [
  'users', 'sessions', 'api_tokens', 'servers', 'token_server_memberships', 'token_server_groups',
  'server_storage', 'server_networks', 'server_metrics', 'sync_jobs', 'audit_logs', 'app_settings',
];

function database(marker) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, createdAt: now, updatedAt: now, nextMetricId: 1, nextAuditId: 1,
    ...Object.fromEntries(collections.map((name) => [name, []])),
    app_settings: [{ key: 'marker', value: marker, updated_at: now }],
  };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cerdasnet-json-scripts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'data', 'database.json');
  const backupDir = path.join(directory, 'backups');
  await mkdir(path.dirname(databaseFile), { recursive: true });
  await writeFile(databaseFile, `${JSON.stringify(database('original'), null, 2)}\n`, { mode: 0o600 });
  const env = {
    ...process.env, DATA_FILE: databaseFile, BACKUP_DIR: backupDir,
    APP_STOPPED: 'YES', RESTORE_CONFIRM: 'YES',
  };
  return { directory, databaseFile, backupDir, env };
}

async function backupFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
}

test('JSON backup writes a verified copy, checksum, and restrictive permissions', async (t) => {
  const { backupDir, env } = await fixture(t);
  const result = await execFileAsync(process.execPath, [backupScript], { env });
  assert.match(result.stdout, /JSON structure verified/);
  const files = await backupFiles(backupDir);
  assert.equal(files.length, 1);
  const archive = path.join(backupDir, files[0]);
  const stored = JSON.parse(await readFile(archive, 'utf8'));
  assert.equal(stored.app_settings[0].value, 'original');
  const checksum = await readFile(`${archive}.sha256`, 'utf8');
  assert.match(checksum, /^[a-f0-9]{64} {2}/);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  assert.equal((await stat(`${archive}.sha256`)).mode & 0o777, 0o600);
});

test('JSON restore enforces guards, creates a safety backup, and restores the selected snapshot', async (t) => {
  const { databaseFile, backupDir, env } = await fixture(t);
  await execFileAsync(process.execPath, [backupScript], { env });
  const [first] = await backupFiles(backupDir);
  const archive = path.join(backupDir, first);
  await writeFile(databaseFile, `${JSON.stringify(database('changed'), null, 2)}\n`);
  const result = await execFileAsync(process.execPath, [restoreScript, archive], { env });
  assert.match(result.stdout, /pre-restore safety backup/);
  assert.match(result.stdout, /Restore completed and JSON structure verified/);
  assert.equal((await backupFiles(backupDir)).length, 2);
  const restored = JSON.parse(await readFile(databaseFile, 'utf8'));
  assert.equal(restored.app_settings[0].value, 'original');
});

test('JSON restore refuses to run without explicit confirmations', async (t) => {
  const { directory, databaseFile, env } = await fixture(t);
  const archive = path.join(directory, 'input.json');
  await writeFile(archive, JSON.stringify(database('archive')));
  const before = await readFile(databaseFile, 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env: { ...env, RESTORE_CONFIRM: 'NO' } }),
    (error) => { assert.match(error.stderr, /RESTORE_CONFIRM=YES/); return true; },
  );
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env: { ...env, APP_STOPPED: 'NO' } }),
    (error) => { assert.match(error.stderr, /APP_STOPPED=YES/); return true; },
  );
  assert.equal(await readFile(databaseFile, 'utf8'), before);
});

test('JSON restore rejects a corrupt archive without changing the current database', async (t) => {
  const { directory, databaseFile, env } = await fixture(t);
  const archive = path.join(directory, 'broken.json');
  await writeFile(archive, '{broken-json');
  const before = await readFile(databaseFile, 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env }),
    (error) => { assert.match(error.stderr, /Invalid JSON/); return true; },
  );
  assert.equal(await readFile(databaseFile, 'utf8'), before);
});

test('JSON restore rejects a checksum mismatch without changing the current database', async (t) => {
  const { databaseFile, backupDir, env } = await fixture(t);
  await execFileAsync(process.execPath, [backupScript], { env });
  const archive = path.join(backupDir, (await backupFiles(backupDir))[0]);
  await writeFile(archive, JSON.stringify(database('tampered')));
  const before = await readFile(databaseFile, 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env }),
    (error) => { assert.match(error.stderr, /checksum does not match/); return true; },
  );
  assert.equal(await readFile(databaseFile, 'utf8'), before);
});

test('JSON restore refuses to replace a database held by a running panel process', async (t) => {
  const { databaseFile, backupDir, env } = await fixture(t);
  await execFileAsync(process.execPath, [backupScript], { env });
  const archive = path.join(backupDir, (await backupFiles(backupDir))[0]);
  await writeFile(`${databaseFile}.lock`, JSON.stringify({ pid: process.pid, token: 'test-lock' }));
  await assert.rejects(
    execFileAsync(process.execPath, [restoreScript, archive], { env }),
    (error) => { assert.match(error.stderr, /still in use/); return true; },
  );
  assert.equal(JSON.parse(await readFile(databaseFile, 'utf8')).app_settings[0].value, 'original');
});
