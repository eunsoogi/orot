import { SymptomEntrySchema } from '../src';

test('restores legacy symptom status from its resolution history', () => {
  const legacy = {
    id: 'legacy-symptom',
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt: '2026-04-20T09:00:00Z',
    ingestedAt: '2026-04-20T09:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic symptom',
  };
  expect(SymptomEntrySchema.parse(legacy).status).toBe('active');
  expect(SymptomEntrySchema.parse({ ...legacy, resolvedAt: '2026-04-21T08:30:00Z' }).status).toBe(
    'resolved',
  );
});
