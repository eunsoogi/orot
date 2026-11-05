import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  findToolMedicationAnchor,
  readToolMedicationAnchor,
} from '../conversationToolMedicationAnchor';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test('a filtered dose source can use an in-range record identity without storing its name', async () => {
  const f = await healthContextFixture();
  try {
    await f.repository.put('medication_definition', {
      ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
      displayText: 'Synthetic A',
    });
    await f.repository.put(
      'dose_event',
      importedDoseEvent('first', '2026-10-01T01:00:00Z', 'taken'),
    );
    await f.repository.put('dose_event', {
      ...importedDoseEvent('second', '2026-10-02T01:00:00Z', 'skipped'),
      ingestedAt: '2026-10-03T00:00:00Z',
    });
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-03T00:00:00Z',
      timeZone: 'UTC',
      doseHistory: { page: 9, pageSize: 1 },
    };
    const anchor = await findToolMedicationAnchor(
      f.database,
      window,
      'sYNTHETIC a',
    );
    expect(anchor).toBe(fingerprint({ kind: 'tool-dose-anchor', id: 'first' }));
    expect(await readToolMedicationAnchor(f.database, window, anchor!)).toBe(
      'Synthetic A',
    );
    expect(
      await findToolMedicationAnchor(f.database, window, 'no match'),
    ).toBeNull();
    await f.repository.delete('dose_event', 'first');
    expect(
      await readToolMedicationAnchor(f.database, window, anchor!),
    ).toBeNull();
  } finally {
    f.close();
  }
});
