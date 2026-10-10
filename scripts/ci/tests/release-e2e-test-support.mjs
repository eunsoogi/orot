import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Keep Smoke's suite-level setup observable without starting a native Simulator.
export async function runSmokeSetup() {
  const beforeAllHooks = [];
  const deviceCalls = [];
  const source = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/smoke.test.js'), 'utf8');

  runInNewContext(source, {
    beforeAll: (hook) => beforeAllHooks.push(hook),
    describe: (_name, callback) => callback(),
    // This probe observes setup only, so it stubs the matcher import without invoking test assertions.
    require: (specifier) => {
      if (specifier !== '@jest/globals') {
        throw new Error(`Unexpected smoke setup dependency: ${specifier}`);
      }
      return { expect: () => {} };
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
