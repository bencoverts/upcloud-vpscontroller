#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, link, mkdir, rm, stat, unlink, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, dumpDatabase, redact, verifyArchive } from './lib/postgres.mjs';

async function availableArchive(backupDir) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const archive = path.join(backupDir, `cerdasnet-${stamp}${suffix ? `-${suffix}` : ''}.dump`);
    try {
      await access(archive);
    } catch (error) {
      if (error?.code === 'ENOENT') return archive;
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique backup filename.');
}

async function sha256(archive) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  return hash.digest('hex');
}

export async function createBackup() {
  process.umask(0o077);
  const backupDir = path.resolve(ROOT_DIR, process.env.BACKUP_DIR || 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const archive = await availableArchive(backupDir);
  const temporary = `${archive}.${process.pid}.tmp`;
  let linked = false;
  let completed = false;
  try {
    await dumpDatabase(temporary);
    await verifyArchive(temporary);
    const details = await stat(temporary);
    if (!details.isFile() || details.size === 0) throw new Error('Backup is empty.');
    await link(temporary, archive);
    linked = true;
    await unlink(temporary);
    const digest = await sha256(archive);
    await writeFile(`${archive}.sha256`, `${digest}  ${archive}\n`, { mode: 0o600 });
    await chmod(archive, 0o600);
    await chmod(`${archive}.sha256`, 0o600);
    completed = true;
    return archive;
  } finally {
    await rm(temporary, { force: true });
    if (linked && !completed) await rm(archive, { force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const archive = await createBackup();
    console.log(`Backup created and catalog verified: ${archive}`);
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
