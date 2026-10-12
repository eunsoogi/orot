import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Observations measure host pressure; they do not attribute a failure to a particular process. */
export function iosTestResourceSampler(path) {
  let index = 0;
  function sample(stage) {
    const entry = { stage, index: index++, timestamp: new Date().toISOString(), observations: {} };
    for (const [name, program, args] of [
      ['memory', 'vm_stat', []],
      ['swap', 'sysctl', ['vm.swapusage']],
      ['processes', 'ps', ['-axo', 'pid,ppid,%cpu,rss,comm']],
    ]) {
      try {
        entry.observations[name] = execFileSync(program, args, {
          encoding: 'utf8',
          timeout: 10000,
        });
      } catch (error) {
        entry.observations[name] = { unavailable: String(error) };
      }
    }
    appendFileSync(path, JSON.stringify(entry) + '\n');
  }
  sample('before');
  const timer = setInterval(() => sample('during'), 20000);
  return () => {
    clearInterval(timer);
    sample('after');
  };
}
