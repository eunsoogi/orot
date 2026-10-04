import { describe, expect, it } from '@jest/globals';
import {
  ManualHistoryCreateInputSchema,
  ManualHistoryEntrySchema,
  ManualHistoryQuerySchema,
  correctManualHistoryEntry,
  createManualHistoryEntry,
  toManualHistoryEvidence,
} from '../src/manualHistory';
import type { ManualHistoryEntry } from '../src/manualHistory';

const recordedAt = '2026-09-15T10:20:00Z';

function createEntry(overrides: Partial<ManualHistoryEntry> = {}): ManualHistoryEntry {
  return createManualHistoryEntry({
    id: 'synthetic-history-1',
    kind: 'diagnosis_history',
    title: 'Synthetic test diagnosis',
    details: 'Synthetic details for a test fixture.',
    effectiveDate: { status: 'known', date: '2024-04-03' },
    recordedAt,
    ...overrides,
  });
}

describe('manual medical history', () => {
  it('requires a known effective date or an explicit unknown state', () => {
    const base = {
      id: 'synthetic-history-1',
      kind: 'procedure',
      title: 'Synthetic procedure',
      details: 'Synthetic procedure detail.',
      recordedAt,
    };

    expect(ManualHistoryCreateInputSchema.safeParse(base).success).toBe(false);
    expect(
      ManualHistoryCreateInputSchema.safeParse({
        ...base,
        effectiveDate: { status: 'known', date: '2024-02-30' },
      }).success,
    ).toBe(false);
    expect(
      ManualHistoryCreateInputSchema.safeParse({
        ...base,
        effectiveDate: { status: 'unknown' },
      }).success,
    ).toBe(true);
  });

  it('sets user-entered provenance and unreviewed state without changing date knowledge', () => {
    const entry = createEntry({ effectiveDate: { status: 'unknown' } });

    expect(entry.effectiveDate).toEqual({ status: 'unknown' });
    expect(entry.recordedAt).toBe(recordedAt);
    expect(entry.ingestedAt).toBe(recordedAt);
    expect(entry.provenance).toEqual({ origin: 'user_reported', sourceRecordIds: [] });
    expect(entry.reviewState).toEqual({ status: 'unreviewed' });
  });

  it.each(['diagnosis_history', 'procedure', 'medication_context', 'note'] as const)(
    'supports the %s entry kind',
    kind => {
      expect(createEntry({ kind }).kind).toBe(kind);
    },
  );

  it('rejects clinician provenance, linked source IDs, and fabricated future ingested time', () => {
    const entry = createEntry();

    expect(
      ManualHistoryEntrySchema.safeParse({
        ...entry,
        provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
      }).success,
    ).toBe(false);
    expect(
      ManualHistoryEntrySchema.safeParse({
        ...entry,
        provenance: { origin: 'user_reported', sourceRecordIds: ['synthetic-source'] },
      }).success,
    ).toBe(false);
    expect(
      ManualHistoryEntrySchema.safeParse({
        ...entry,
        ingestedAt: '2026-09-15T10:19:59Z',
      }).success,
    ).toBe(false);
  });

  it('creates a linked correction without modifying the prior entry', () => {
    const previous = createEntry();
    const before = structuredClone(previous);
    const corrected = correctManualHistoryEntry(
      previous,
      {
        kind: 'diagnosis_history',
        title: 'Corrected synthetic diagnosis',
        details: 'Corrected synthetic details.',
        effectiveDate: { status: 'unknown' },
        correctionNote: 'The original date was not known.',
      },
      { id: 'synthetic-history-2', recordedAt: '2026-09-16T11:00:00Z' },
    );

    expect(corrected.id).toBe('synthetic-history-2');
    expect(corrected.supersedesId).toBe(previous.id);
    expect(corrected.effectiveDate).toEqual({ status: 'unknown' });
    expect(corrected.reviewState).toEqual({ status: 'unreviewed' });
    expect(toManualHistoryEvidence(corrected)).toMatchObject({
      supersedesId: previous.id,
      correctionNote: 'The original date was not known.',
    });
    expect(previous).toEqual(before);
    expect(corrected).not.toBe(previous);
  });

  it('validates structured query date ranges and explicit unknown filters', () => {
    expect(
      ManualHistoryQuerySchema.safeParse({
        effectiveDateFrom: '2025-04-01',
        effectiveDateThrough: '2025-03-31',
      }).success,
    ).toBe(false);
    expect(
      ManualHistoryQuerySchema.safeParse({
        dateStatus: 'unknown',
        effectiveDateFrom: '2025-01-01',
      }).success,
    ).toBe(false);
    expect(ManualHistoryQuerySchema.parse({}).includeSuperseded).toBe(false);
  });

  it('exposes source text and date knowledge to future RAG consumers', () => {
    const entry = createEntry({ effectiveDate: { status: 'unknown' } });

    expect(toManualHistoryEvidence(entry)).toEqual({
      id: 'manual-history-evidence:synthetic-history-1',
      sourceEntryId: 'synthetic-history-1',
      kind: 'diagnosis_history',
      text: 'Synthetic test diagnosis\nSynthetic details for a test fixture.',
      effectiveDate: { status: 'unknown' },
      recordedAt,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
  });
});
