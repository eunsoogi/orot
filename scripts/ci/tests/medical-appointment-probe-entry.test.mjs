import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const selectEntryRoute = requireFromRepository(
  './apps/mobile/e2e/selectEntryRoute.js',
).selectEntryRoute;
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');

test('loads agent runtime polyfills before both medical appointment probes import', () => {
  // LangGraph reads ReadableStream during module initialization on Hermes.
  for (const entryName of [
    'medicalAppointmentClassificationProbeEntry.tsx',
    'medicalAppointmentNavigationProbeEntry.tsx',
  ]) {
    const entry = readFileSync(join(repositoryRoot, 'apps/mobile/e2e', entryName), 'utf8');

    assert.match(entry, /^(?:\/\/[^\n]*\n)?import '\.\.\/src\/agent\/polyfills';/);
  }
});

test('routes #108 through App and includes its probe in the required Release suite', () => {
  const router = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/e2eRouterEntry.tsx'), 'utf8');
  assert.equal(
    selectEntryRoute({ OROT_E2E_PROBE: 'medical-appointment-app-navigation' }),
    'medical-appointment-app-navigation',
  );
  assert.ok(router.includes("case 'medical-appointment-classification':"));
  assert.ok(router.includes("require('./medicalAppointmentClassificationProbeEntry')"));
  assert.ok(router.includes("case 'medical-appointment-app-navigation':"));
  assert.ok(router.includes("require('./medicalAppointmentNavigationProbeEntry')"));
  assert.ok(releaseSuiteFiles.includes('./medicalAppointmentNavigation.test.js'));
});
