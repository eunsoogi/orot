import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));

// Keep Smoke's suite-level setup observable without starting a native Simulator.
export async function runSmokeSetup() {
  const beforeAllHooks = [];
  const deviceCalls = [];
  const source = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/smoke.test.js'), 'utf8');
  const resetGuard = requireFromRepository('./apps/mobile/e2e/storageProbeResetGuard.e2e.js');

  runInNewContext(source, {
    beforeAll: (hook) => beforeAllHooks.push(hook),
    describe: (_name, callback) => callback(),
    // This probe observes setup only, so it stubs the matcher import without invoking test assertions.
    require: (specifier) => {
      if (specifier === './storageProbeResetGuard.e2e.js') return resetGuard;
      if (specifier === '@jest/globals') return { expect: () => {} };
      throw new Error(`Unexpected smoke setup dependency: ${specifier}`);
    },
    device: {
      uninstallApp: async () => deviceCalls.push({ kind: 'uninstallApp' }),
      clearKeychain: async () => deviceCalls.push({ kind: 'clearKeychain' }),
      installApp: async () => deviceCalls.push({ kind: 'installApp' }),
      launchApp: async (options) =>
        deviceCalls.push({ kind: 'launch', options: JSON.parse(JSON.stringify(options)) }),
    },
    it: () => {},
  });

  for (const hook of beforeAllHooks) await hook();
  return deviceCalls;
}
