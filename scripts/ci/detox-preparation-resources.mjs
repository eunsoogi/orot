import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const [mode, profile, directory, token] = process.argv.slice(2);
if (!['start', 'stop', 'watch'].includes(mode) || !directory)
  throw new Error('Invalid resource sampler arguments');
const root = resolve(directory);
const identityPath = join(root, 'preparation-resource-sampler.json');
const logPath = join(root, 'detox-preparation-resource-samples.log');

function observe() {
  // Host RSS includes shared pages and other processes; it is not private Simulator footprint.
  appendFileSync(logPath, `DETOX_PREPARATION_RESOURCE_SAMPLE utc=${new Date().toISOString()}\n`);
  for (const [command, args] of [
    ['ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'rss=', '-o', 'comm=']],
    ['vm_stat', []],
    ['sysctl', ['vm.swapusage']],
  ]) {
    try {
      const output = execFileSync(command, args, { encoding: 'utf8', timeout: 3000 });
      appendFileSync(logPath, `${command} ${args.join(' ')}\n${output}\n`);
    } catch {
      appendFileSync(logPath, `${command}: observation unavailable\n`);
    }
  }
}

if (mode === 'start') {
  if (profile !== 'transcription' || process.env.OROT_DETOX_RESOURCE_SAMPLING !== 'true')
    process.exit(0);
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Preparation sampling requires GitHub Actions');
  if (
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('Preparation sampling requires a run and attempt identity');
  mkdirSync(root, { recursive: true });
  if (existsSync(identityPath)) throw new Error('Preparation sampler identity already exists');
  const identity = {
    token: randomUUID(),
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  const child = spawn(process.execPath, [script, 'watch', profile, root, identity.token], {
    detached: true,
    stdio: 'ignore',
  });
  writeFileSync(identityPath, JSON.stringify({ ...identity, pid: child.pid }));
  child.unref();
} else if (mode === 'stop') {
  if (!existsSync(identityPath)) process.exit(0);
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  if (
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 1 ||
    !/^[a-f0-9-]{36}$/.test(identity.token) ||
    identity.runId !== process.env.GITHUB_RUN_ID ||
    identity.attempt !== process.env.GITHUB_RUN_ATTEMPT
  )
    throw new Error('Resource sampler ownership mismatch');
  let command;
  try {
    command = execFileSync('ps', ['-p', String(identity.pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch {
    // A bounded sampler may already have exited; never signal a reused PID without matching its command.
    unlinkSync(identityPath);
    process.exit(0);
  }
  if (!command.endsWith(`${script} watch ${profile} ${root} ${identity.token}`))
    throw new Error('Resource sampler process mismatch');
  process.kill(identity.pid, 'SIGTERM');
  unlinkSync(identityPath);
} else {
  if (!/^[a-f0-9-]{36}$/.test(token ?? '')) throw new Error('Resource sampler token missing');
  let timer;
  let count = 0;
  const finish = () => {
    clearInterval(timer);
    appendFileSync(logPath, `DETOX_PREPARATION_RESOURCE_END utc=${new Date().toISOString()}\n`);
    process.exit(0);
  };
  process.on('SIGTERM', finish);
  observe();
  // Bound the helper to the existing 75-minute job even if a failed step cannot call cleanup.
  timer = setInterval(() => {
    observe();
    if (++count >= 300) finish();
  }, 15000);
}
