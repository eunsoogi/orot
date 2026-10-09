import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function installDetoxHostSamplerStubs(directory) {
  // Wrapper tests use deterministic host commands without starting an Apple Simulator.
  const commands = {
    ps: 'if [[ "${1:-}" == -p ]]; then printf "S\\n"; else printf "123 1 0.0 2048 00:01 node\\n"; fi',
    top: 'printf "Processes: 1 total\\nCPU usage: 1.0% user, 2.0% sys, 97.0% idle\\nProcesses: 1 total\\nCPU usage: 1.0% user, 2.0% sys, 97.0% idle\\n"',
    vm_stat: 'printf "Pages free: 123.\\nPageins: 456.\\nPageouts: 789.\\n"',
    sysctl:
      'case "$1:$2" in -n:hw.logicalcpu) printf "8\\n" ;; -n:hw.memsize) printf "17179869184\\n" ;; vm.swapusage:) printf "vm.swapusage: total = 0.00M used = 0.00M free = 0.00M\\n" ;; *) exit 1 ;; esac',
    time: '[[ "${1:-}" == -l ]] || exit 64; shift; printf "0.00 real 0.00 user 0.00 sys\\n" >&2; "$@"',
    uname:
      'if [[ "${1:-}" == -m ]]; then printf "%s\\n" "${EXPECTED_HOST_ARCH:-x86_64}"; else printf "Darwin\\n"; fi',
  };

  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(
      join(directory, name),
      [
        '#!/usr/bin/env bash',
        'if [[ -n "${DETOX_SAMPLER_CALLS:-}" ]]; then printf "%s %s\\n" "' +
          name +
          '" "$*" >> "$DETOX_SAMPLER_CALLS"; fi',
        body,
      ].join('\n'),
      { mode: 0o755 },
    );
  }
}
