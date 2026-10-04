import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function installDetoxHostSamplerStubs(directory) {
  const commands = {
    ps: 'if [[ "${1:-}" == -p ]]; then printf "S\\n"; else printf "123 1 0.0 2048 00:01 node\\n"; fi',
    top: 'printf "Processes: 1 total\\nCPU usage: 1.0% user, 2.0% sys, 97.0% idle\\nProcesses: 1 total\\nCPU usage: 1.0% user, 2.0% sys, 97.0% idle\\n"',
    vm_stat: 'printf "Pages free: 123.\\nPageins: 456.\\nPageouts: 789.\\n"',
    sysctl: 'printf "vm.swapusage: total = 0.00M used = 0.00M free = 0.00M\\n"',
    uname: 'printf "Darwin\\n"',
  };

  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(directory, name), [
      '#!/usr/bin/env bash',
      `printf '%s %s\\n' '${name}' "$*" >> "$DETOX_SAMPLER_CALLS"`,
      body,
    ].join('\n'), { mode: 0o755 });
  }
}
