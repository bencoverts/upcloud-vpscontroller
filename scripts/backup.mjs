#!/usr/bin/env node
import { access, chmod, link, mkdir, open, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseFile, readDatabase, ROOT_DIR, sha256 } from './lib/json-database.mjs';

async function availableArchive(backupDir) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const archive = path.join(backupDir, `cerdasnet-${stamp}${suffix ? `-${suffix}` : ''}.json`);
    try { await access(archive); } catch (error) {
      if (error?.code === 'ENOENT') return archive;
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique backup filename.');
}

export async function createBackup() {
  process.umask(0o077);
  const { raw } = await readDatabase(databaseFile);
  const backupDir = path.resolve(ROOT_DIR, process.env.BACKUP_DIR || 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const archive = await availableArchive(backupDir);
  const temporary = `${archive}.${process.pid}.tmp`;
  let linked = false;
  let completed = false;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(raw, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const details = await stat(temporary);
    if (!details.isFile() || details.size === 0) throw new Error('Backup is empty.');
    await link(temporary, archive);
    linked = true;
    await unlink(temporary);
    const digest = sha256(raw);
    await writeFile(`${archive}.sha256`, `${digest}  ${archive}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(archive, 0o600);
    await chmod(`${archive}.sha256`, 0o600);
    completed = true;
    return archive;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
    if (linked && !completed) {
      await rm(archive, { force: true });
      await rm(`${archive}.sha256`, { force: true });
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const archive = await createBackup();
    console.log(`Backup created and JSON structure verified: ${archive}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
