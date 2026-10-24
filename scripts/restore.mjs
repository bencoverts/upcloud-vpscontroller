#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createBackup } from './backup.mjs';
import {
  acquireDatabaseLock, databaseFile, readDatabase, ROOT_DIR, sha256, writeFileAtomic,
} from './lib/json-database.mjs';

async function verifyChecksum(archive, raw) {
  let sidecar;
  try { sidecar = await readFile(`${archive}.sha256`, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const match = sidecar.match(/^([a-f0-9]{64})\s/u);
  if (!match) throw new Error('Backup checksum sidecar is invalid.');
  if (match[1] !== sha256(raw)) throw new Error('Backup checksum does not match. Restore refused.');
}

async function restore() {
  process.umask(0o077);
  const usage = 'Usage: APP_STOPPED=YES RESTORE_CONFIRM=YES node scripts/restore.mjs backups/file.json';
  if (process.argv.length !== 3) throw new Error(usage);
  const archive = path.resolve(ROOT_DIR, process.argv[2]);
  const details = await stat(archive).catch(() => null);
  if (!details?.isFile() || details.size === 0) throw new Error('Restore archive not found or empty.');
  if (process.env.RESTORE_CONFIRM !== 'YES') {
    throw new Error('Refusing restore: set RESTORE_CONFIRM=YES after reviewing the archive.');
  }
  if (process.env.APP_STOPPED !== 'YES') {
    throw new Error('Refusing restore: stop the app/PM2 process and set APP_STOPPED=YES.');
  }

  const { raw } = await readDatabase(archive);
  await verifyChecksum(archive, raw);
  const releaseLock = await acquireDatabaseLock();
  let safetyBackup = null;
  try {
    const existing = await stat(databaseFile).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing) {
      console.log('Creating a pre-restore safety backup...');
      safetyBackup = await createBackup();
    } else console.log('No existing JSON database found; skipping pre-restore safety backup.');
    await writeFileAtomic(databaseFile, raw);
    await readDatabase(databaseFile);
  } catch (error) {
    throw new Error(`Restore failed${safetyBackup ? `; safety backup: ${safetyBackup}` : ''}: ${error instanceof Error ? error.message : error}`);
  } finally {
    await releaseLock();
  }
  console.log('Restore completed and JSON structure verified. Start the app and run health checks before accepting traffic.');
}

try {
  await restore();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
