import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';
import { createSymptomJournalRepository } from './localRepository';
import type { SymptomRepository } from '@orot/storage';

const onsetAt = '2026-04-20T08:30:00Z';
const recordedAt = '2026-05-01T12:00:00Z';

function sampleEntry(): SymptomEntry {
  return SymptomEntrySchema.parse({
    id: 'symptom-1',
    effectiveAt: onsetAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic tingling',
    status: 'active',
  });
}

describe('local symptom journal adapter', () => {
  it('creates with recorded time and user provenance, edits without changing it, and resolves once', async () => {
    const entry = sampleEntry();
    let current: SymptomEntry | null = entry;
    const storage = {
      list: jest.fn(async () => current ? [current] : []),
      create: jest.fn(async (value: SymptomEntry) => {
        current = value;
        return value;
      }),
      get: jest.fn(async () => current),
      update: jest.fn(async (value: SymptomEntry) => {
        current = value;
        return value;
      }),
      resolve: jest.fn(async (_id: string, resolvedAt: string) => {
        if (!current) return null;
        current = SymptomEntrySchema.parse({ ...current, status: 'resolved', resolvedAt });
        return current;
      }),
    } as SymptomRepository;
    const journal = createSymptomJournalRepository(storage, {
      now: () => recordedAt,
      createId: () => 'symptom-1',
    });

    const created = await journal.create({
      onsetAt,
      description: 'Synthetic tingling',
      status: 'active',
    });
    expect(storage.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'symptom-1',
      effectiveAt: onsetAt,
      recordedAt,
      ingestedAt: recordedAt,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'active',
    }));

    const updated = await journal.update(created.id, {
      description: 'Synthetic tingling after exercise',
      bodySite: null,
      severity: 3,
    });
    expect(updated).toMatchObject({
      effectiveAt: onsetAt,
      recordedAt,
      ingestedAt: recordedAt,
      description: 'Synthetic tingling after exercise',
      severity: 3,
      status: 'active',
    });

    await journal.resolve(created.id);
    expect(storage.resolve).toHaveBeenCalledWith('symptom-1', recordedAt);
    expect(current).toMatchObject({ status: 'resolved', resolvedAt: recordedAt });
  });
});
