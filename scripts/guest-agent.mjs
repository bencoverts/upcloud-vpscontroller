#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const panelUrl = process.env.PANEL_URL;
const agentToken = process.env.AGENT_TOKEN;
const serverUuid = process.env.SERVER_UUID;
if (!panelUrl || !agentToken || !serverUuid) {
  console.error('PANEL_URL, AGENT_TOKEN, and SERVER_UUID are required.');
  process.exit(2);
}
const origin = new URL(panelUrl);
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
  console.error('PANEL_URL must use HTTPS outside local development.');
  process.exit(2);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serverUuid)) {
  console.error('SERVER_UUID must be a valid UUID.');
  process.exit(2);
}
const intervalSeconds = Math.min(3600, Math.max(15, Number(process.env.AGENT_INTERVAL_SECONDS) || 60));
const endpoint = new URL('/api/agent/v1/metrics', origin).toString();
let stopped = false;
let timer;

function number(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Agent collected an invalid numeric value.');
  return parsed;
}

async function filesystems() {
  const excluded = ['tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'ramfs', 'debugfs', 'tracefs', 'fusectl',
    'configfs', 'binfmt_misc', 'cgroup', 'cgroup2', 'proc', 'sysfs', 'devpts', 'securityfs', 'pstore',
    'bpf', 'autofs', 'hugetlbfs', 'mqueue', 'nfs', 'nfs4', 'cifs', 'fuse.sshfs'];
  const args = ['-B1', '-P', ...excluded.flatMap((type) => ['-x', type])];
  const { stdout } = await exec('df', args, { timeout: 10_000, maxBuffer: 1024 * 1024 });
  const devices = new Map();
  for (const line of stdout.trim().split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 6 || !columns[0].startsWith('/dev/')) continue;
    const [source, total, used] = columns;
    // Bind mounts of the same source must not be counted more than once.
    if (!devices.has(source)) devices.set(source, { total: number(total), used: number(used), mount: columns.slice(5).join(' ') });
  }
  if (devices.size === 0) throw new Error('No local block filesystem was found by df.');
  const values = [...devices.entries()].map(([source, item]) => ({ source, ...item }));
  return {
    filesystemUsedBytes: values.reduce((sum, item) => sum + item.used, 0),
    filesystemTotalBytes: values.reduce((sum, item) => sum + item.total, 0),
    filesystemCount: values.length,
    filesystems: values.slice(0, 64).map((item) => ({ source: item.source, mount: item.mount, totalBytes: item.total, usedBytes: item.used })),
  };
}

async function guestMetrics() {
  const [disk, meminfoRaw, uptimeRaw, loadRaw, osRelease] = await Promise.all([
    filesystems(), readFile('/proc/meminfo', 'utf8'), readFile('/proc/uptime', 'utf8'), readFile('/proc/loadavg', 'utf8'),
    readFile('/etc/os-release', 'utf8').catch(() => ''),
  ]);
  const meminfo = new Map(meminfoRaw.split('\n').flatMap((line) => {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB/);
    return match ? [[match[1], Number(match[2]) * 1024]] : [];
  }));
  const osUptimeSeconds = Number(uptimeRaw.trim().split(/\s+/)[0]);
  const load = loadRaw.trim().split(/\s+/).slice(0, 3).map(Number);
  if (load.length !== 3 || load.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Agent collected invalid load averages.');
  const processCount = Number(loadRaw.trim().split(/\s+/)[3]?.split('/')[1]);
  const osName = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?$/m)?.[1] ?? null;
  if (!Number.isFinite(osUptimeSeconds) || osUptimeSeconds < 0) throw new Error('Agent collected an invalid OS uptime.');
  const memoryTotal = meminfo.get('MemTotal');
  const memoryAvailable = meminfo.get('MemAvailable');
  const swapTotal = meminfo.get('SwapTotal') ?? null;
  const swapFree = meminfo.get('SwapFree') ?? null;
  return {
    serverUuid,
    ...disk,
    memoryUsedBytes: memoryTotal !== undefined && memoryAvailable !== undefined ? Math.max(0, memoryTotal - memoryAvailable) : null,
    memoryTotalBytes: memoryTotal ?? null,
    swapUsedBytes: swapTotal !== null && swapFree !== null ? Math.max(0, swapTotal - swapFree) : null,
    swapTotalBytes: swapTotal,
    osUptimeSeconds,
    load1: load[0], load5: load[1], load15: load[2],
    processCount: Number.isSafeInteger(processCount) && processCount > 0 ? processCount : null,
    osName, agentVersion: '1.1.0',
  };
}

async function submit() {
  try {
    const metrics = await guestMetrics();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agentToken}`,
          'Content-Type': 'application/json', Accept: 'application/json',
          'User-Agent': 'CerdasNet-Guest-Agent/1.1',
        },
        body: JSON.stringify(metrics), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        console.error(`Panel rejected agent metrics with HTTP ${response.status}.`);
        if ([400, 401, 403, 404].includes(response.status)) return 60_000;
        return 30_000;
      }
      await response.arrayBuffer();
      return intervalSeconds * 1000;
    } finally { clearTimeout(timeout); }
  } catch (error) {
    console.error(`Agent collection/submission failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return 30_000;
  }
}

async function loop() {
  while (!stopped) {
    const delay = await submit();
    if (stopped) break;
    await new Promise((resolve) => { timer = setTimeout(resolve, delay); });
  }
}
function shutdown() {
  stopped = true;
  clearTimeout(timer);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
await loop();
