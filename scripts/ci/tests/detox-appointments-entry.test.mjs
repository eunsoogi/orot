import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('selects the E2E-only appointments screen backed by encrypted local storage', () => {
  const router = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/e2eRouterEntry.tsx'), 'utf8');
  const appointmentsEntry = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/appointmentsProbeEntry.tsx'),
    'utf8',
  );
  const appointmentsTest = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/appointments.test.js'),
    'utf8',
  );

  assert.match(router, /case 'appointments':\s*require\('\.\/appointmentsProbeEntry'\)/);
  // The manual route supplies the same encrypted repository plus shared navigation.
  assert.match(appointmentsEntry, /ManualAppointmentScreen/);
  assert.match(appointmentsEntry, /openLocalAppointmentRepository/);
  assert.equal((appointmentsTest.match(/OROT_E2E_PROBE: 'appointments'/g) ?? []).length, 3);
  assert.match(appointmentsTest, /tapAppointmentsBack/);
  assert.match(appointmentsTest, /welcome-title/);
  assert.match(appointmentsTest, /appointments-title/);
  assert.match(appointmentsTest, /appointment-add/);
  assert.match(appointmentsTest, /appointments-empty/);
  assert.doesNotMatch(appointmentsTest, /appointments-probe-ready/);
});
