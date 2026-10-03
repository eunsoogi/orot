import { SymptomEntrySchema } from '../src/records';
import {
  CreateSymptomEntryInputSchema,
  createSymptomEntry,
  editSymptomEntry,
  filterSymptomEntries,
  resolveSymptomEntry,
} from '../src/symptoms';
import type { SymptomEntry } from '../src/records';

const recordedAt = '2026-05-01T12:00:00Z';

function symptom(
  id: string,
  onsetAt: string,
  status: 'active' | 'resolved' = 'active',
): SymptomEntry {
  return createSymptomEntry({
    id,
    onsetAt,
    recordedAt,
    description: 'Intermittent hand tingling',
    status,
    ...(status === 'resolved' ? { resolvedAt: '2026-05-01T11:00:00Z' } : {}),
  });
}

describe('symptom entry service', () => {
  it('creates a user-entered, unreviewed record with explicit status and distinct times', () => {
    expect(createSymptomEntry({
      id: 'symptom-1',
      onsetAt: '2026-04-20T08:30:00+09:00',
      recordedAt,
      ingestedAt: '2026-05-01T12:00:01Z',
      description: '  Intermittent hand tingling  ',
      severity: 6,
      status: 'active',
    })).toEqual({
      id: 'symptom-1',
      effectiveAt: '2026-04-20T08:30:00+09:00',
      recordedAt,
      ingestedAt: '2026-05-01T12:00:01Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      description: 'Intermittent hand tingling',
      severity: 6,
      status: 'active',
    });
  });

  it('requires an explicit status and rejects inferred diagnosis fields', () => {
    const base = {
      id: 'symptom-1',
      onsetAt: '2026-04-20T08:30:00Z',
      recordedAt,
      description: 'Intermittent hand tingling',
    };
    expect(() => CreateSymptomEntryInputSchema.parse(base)).toThrow();
    expect(() => CreateSymptomEntryInputSchema.parse({
      ...base,
      status: 'active',
      diagnosis: 'carpal tunnel syndrome',
    })).toThrow();
  });

  it('reads legacy symptom entries without status and derives it from resolution history', () => {
    const oldActive = { ...symptom('legacy-active', '2026-04-20T08:30:00Z') } as
      Record<string, unknown>;
    delete oldActive.status;
    expect(SymptomEntrySchema.parse(oldActive)).toMatchObject({ status: 'active' });

    const oldResolved = { ...symptom('legacy-resolved', '2026-04-20T08:30:00Z', 'resolved') } as
      Record<string, unknown>;
    delete oldResolved.status;
    expect(SymptomEntrySchema.parse(oldResolved)).toMatchObject({ status: 'resolved' });
  });

  it('edits user-entered details without changing onset, recorded, ingested, or provenance data', () => {
    const original = createSymptomEntry({
      id: 'symptom-1',
      onsetAt: '2026-04-20T08:30:00Z',
      recordedAt,
      ingestedAt: '2026-05-01T12:00:02Z',
      description: 'Intermittent hand tingling',
      bodySite: 'left hand',
      severity: 6,
      status: 'active',
    });

    const edited = editSymptomEntry(original, {
      description: 'Tingling after exercise',
      bodySite: null,
      severity: null,
    });

    expect(edited).toMatchObject({
      id: original.id,
      effectiveAt: original.effectiveAt,
      recordedAt: original.recordedAt,
      ingestedAt: original.ingestedAt,
      provenance: original.provenance,
      reviewState: original.reviewState,
      description: 'Tingling after exercise',
      status: 'active',
    });
    expect(edited).not.toHaveProperty('bodySite');
    expect(edited).not.toHaveProperty('severity');
    expect(() => editSymptomEntry(original, {
      description: 'Changed onset',
      effectiveAt: '2026-04-21T08:30:00Z',
    } as never)).toThrow();
  });

  it('resolves once and keeps original timestamps intact', () => {
    const original = symptom('symptom-1', '2026-04-20T08:30:00Z');
    const resolved = resolveSymptomEntry(original, '2026-05-01T13:00:00Z');

    expect(resolved).toMatchObject({
      effectiveAt: original.effectiveAt,
      recordedAt: original.recordedAt,
      ingestedAt: original.ingestedAt,
      provenance: original.provenance,
      reviewState: original.reviewState,
      status: 'resolved',
      resolvedAt: '2026-05-01T13:00:00Z',
    });
    expect(() => resolveSymptomEntry(resolved, '2026-05-01T14:00:00Z')).toThrow(
      'A resolved symptom cannot be resolved again.',
    );
    expect(() => resolveSymptomEntry(original, '2026-04-20T08:29:00Z')).toThrow();
  });

  it('filters inclusively by onset range and status across timestamp offsets and precision', () => {
    const exactBoundary = symptom('boundary', '2026-01-01T02:00:00+02:00');
    const justAfter = symptom('after', '2026-01-01T00:00:00.000000001Z');
    const resolved = symptom('resolved', '2026-01-01T00:00:00Z', 'resolved');

    expect(filterSymptomEntries([justAfter, resolved, exactBoundary], {
      status: 'active',
      fromOnsetAt: '2026-01-01T00:00:00Z',
      throughOnsetAt: '2026-01-01T00:00:00Z',
    }).map(entry => entry.id)).toEqual(['boundary']);
    expect(() => filterSymptomEntries([exactBoundary], {
      fromOnsetAt: '2026-01-02T00:00:00Z',
      throughOnsetAt: '2026-01-01T00:00:00Z',
    })).toThrow();
  });
});
