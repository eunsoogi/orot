import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('history returns a content-free quarantine reason without loading raw text or restoring source data', async () => {
  const status = {
    status: 'unavailable' as const,
    reason: 'legacy_period_unverified' as const,
  };
  const storage = {
    list: jest.fn(async () => []),
    append: jest.fn(async () => {}),
    read: jest.fn(async () => null),
    readWithStatus: jest.fn(async () => status),
  };
  const data = jest.fn(async () => localData([]).data);
  const persistence = createSymptomSummaryPersistence({
    storage: async () => storage,
    data,
    registry: new LocalEvidenceReferenceRegistry(),
  });
  expect(await persistence.history.readStatus!('quarantined')).toEqual(status);
  expect(storage.read).not.toHaveBeenCalled();
  expect(data).not.toHaveBeenCalled();
  expect(status).not.toHaveProperty('summary');
  expect(status).not.toHaveProperty('analysis');
});
