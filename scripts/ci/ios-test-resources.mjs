import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Observations measure host pressure; they do not attribute a failure to a particular process. */
export function iosTestResourceSnapshot(path, stage, index = 0, execute = execFileSync) {
  const entry = { stage, index, timestamp: new Date().toISOString(), observations: {} };
  for (const [name, program, args] of [
    ['memory', 'vm_stat', []],
    ['swap', 'sysctl', ['vm.swapusage']],
    ['processes', 'ps', ['-axo', 'pid,ppid,%cpu,rss,comm']],
  ]) {
    try {
      entry.observations[name] = execute(program, args, {
        encoding: 'utf8',
        timeout: 10000,
      });
    } catch (error) {
      entry.observations[name] = { unavailable: String(error) };
    }
  }
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

/** Sampling spans the owned compiler/test command; executable names avoid collecting command-line arguments or their possible secrets. */
export function iosTestResourceSampler(path) {
  let index = 0;
  const sample = (stage) => iosTestResourceSnapshot(path, stage, index++);
  sample('before');
  const timer = setInterval(() => sample('during'), 20000);
  return () => {
    clearInterval(timer);
    sample('after');
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, stage] = process.argv.slice(2);
  if (!path || !stage) throw new Error('Resource snapshots require an evidence path and stage');
  mkdirSync(dirname(resolve(path)), { recursive: true });
  iosTestResourceSnapshot(path, stage);
}
