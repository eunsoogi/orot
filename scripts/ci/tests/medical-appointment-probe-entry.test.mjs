import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('loads agent runtime polyfills before the classification probe imports', () => {
  // LangGraph reads ReadableStream during module initialization on Hermes.
  const entry = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/medicalAppointmentClassificationProbeEntry.tsx'),
    'utf8',
  );

  assert.match(entry, /^(?:\/\/[^\n]*\n)?import '\.\.\/src\/agent\/polyfills';/);
});
