#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT_DIR, assertDatabaseConfigured, assertDatabaseReady, redact,
  restoreArchive, run, verifyArchive, verifyRestoredSchema,
} from './lib/postgres.mjs';

async function restore() {
  process.umask(0o077);
  const usage = 'Usage: APP_STOPPED=YES RESTORE_CONFIRM=YES node scripts/restore.mjs backups/file.dump';
  if (process.argv.length !== 3) throw new Error(usage);
  const archive = path.resolve(ROOT_DIR, process.argv[2]);
  const details = await stat(archive).catch(() => null);
  if (!details?.isFile() || details.size === 0) throw new Error('Restore archive not found or empty.');
  if (process.env.RESTORE_CONFIRM !== 'YES') {
    throw new Error('Refusing restore: set RESTORE_CONFIRM=YES after reviewing the archive.');
  }
  if (process.env.APP_STOPPED !== 'YES') {
    throw new Error('Refusing restore: stop the app and set APP_STOPPED=YES.');
  }

  assertDatabaseConfigured();
  await verifyArchive(archive);
  await assertDatabaseReady();
  console.log('Creating a pre-restore safety backup...');
  await run(process.execPath, [path.join(ROOT_DIR, 'scripts', 'backup.mjs')], { showStdout: true });
  await restoreArchive(archive);
  await verifyRestoredSchema();
  console.log('Restore completed and required tables verified. Start the app and run health checks before accepting traffic.');
}

try {
  await restore();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
}
