import { describe, expect, it } from '@jest/globals';
import { EncounterSchema, SymptomEntrySchema } from '../src';
import { metadata } from './fixtures';

describe('effective intervals', () => {
  it('rejects encounter and symptom end times before their effective start', () => {
    const encounter = EncounterSchema.safeParse({
      ...metadata('reversed-encounter-1'),
      encounterKind: 'outpatient',
      endedAt: '2026-02-03T08:59:00-05:00',
    });
    const symptom = SymptomEntrySchema.safeParse({
      ...metadata('reversed-symptom-1'),
      description: 'Synthetic symptom',
      resolvedAt: '2026-02-03T08:59:00-05:00',
    });

    expect(encounter.success).toBe(false);
    expect(symptom.success).toBe(false);
  });
});
