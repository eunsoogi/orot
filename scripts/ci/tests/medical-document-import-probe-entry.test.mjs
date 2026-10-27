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
const router = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/e2eRouterEntry.tsx'), 'utf8');
const probeEntry = readFileSync(
  join(repositoryRoot, 'apps/mobile/e2e/medicalDocumentImportProbeEntry.tsx'),
  'utf8',
);

test('routes the medical document journey through the production App', () => {
  assert.equal(
    selectEntryRoute({ OROT_E2E_PROBE: 'medical-document-import' }),
    'medical-document-import',
  );
  assert.ok(router.includes("case 'medical-document-import':"));
  assert.ok(router.includes("require('./medicalDocumentImportProbeEntry')"));
  assert.match(probeEntry, /return <App \/>;/u);
});
