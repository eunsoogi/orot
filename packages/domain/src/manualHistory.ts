import { z } from 'zod';
import { RecordIdSchema, ReviewStateSchema, TimestampSchema, compareTimestamps } from './common';

const NonEmptyTextSchema = z.string().trim().min(1);

export const ManualHistoryKindSchema = z.enum([
  'diagnosis_history',
  'procedure',
  'medication_context',
  'note',
]);

export const ManualHistoryDateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), date: z.iso.date() }),
  z.strictObject({ status: z.literal('unknown') }),
]);

export const ManualHistoryProvenanceSchema = z.strictObject({
  origin: z.literal('user_reported'),
  sourceRecordIds: z.array(RecordIdSchema).length(0),
});

const ManualHistoryContentSchema = z.strictObject({
  kind: ManualHistoryKindSchema,
  title: NonEmptyTextSchema,
  details: NonEmptyTextSchema,
  effectiveDate: ManualHistoryDateSchema,
});

export const ManualHistoryEntrySchema = z
  .strictObject({
    id: RecordIdSchema,
    ...ManualHistoryContentSchema.shape,
    recordedAt: TimestampSchema,
    ingestedAt: TimestampSchema,
    provenance: ManualHistoryProvenanceSchema,
    reviewState: ReviewStateSchema,
    supersedesId: RecordIdSchema.optional(),
    correctionNote: NonEmptyTextSchema.optional(),
  })
  .superRefine((entry, context) => {
    if (compareTimestamps(entry.recordedAt, entry.ingestedAt) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['ingestedAt'],
        message: 'ingestedAt must not precede recordedAt.',
      });
    }

    if (entry.supersedesId === entry.id) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesId'],
        message: 'A manual history entry cannot supersede itself.',
      });
    }

    if (entry.correctionNote && !entry.supersedesId) {
      context.addIssue({
        code: 'custom',
        path: ['correctionNote'],
        message: 'A correction note requires a superseded entry.',
      });
    }
  });

export const ManualHistoryCreateInputSchema = z
  .strictObject({
    id: RecordIdSchema,
    ...ManualHistoryContentSchema.shape,
    recordedAt: TimestampSchema,
    ingestedAt: TimestampSchema.optional(),
    supersedesId: RecordIdSchema.optional(),
    correctionNote: NonEmptyTextSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.supersedesId === input.id) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesId'],
        message: 'A manual history entry cannot supersede itself.',
      });
    }

    if (input.correctionNote && !input.supersedesId) {
      context.addIssue({
        code: 'custom',
        path: ['correctionNote'],
        message: 'A correction note requires a superseded entry.',
      });
    }
  });

export const ManualHistoryCorrectionInputSchema = z
  .strictObject({
    ...ManualHistoryContentSchema.shape,
    correctionNote: NonEmptyTextSchema.optional(),
  });

export const ManualHistoryQuerySchema = z
  .strictObject({
    kind: ManualHistoryKindSchema.optional(),
    dateStatus: z.enum(['known', 'unknown']).optional(),
    effectiveDateFrom: z.iso.date().optional(),
    effectiveDateThrough: z.iso.date().optional(),
    search: NonEmptyTextSchema.optional(),
    includeSuperseded: z.boolean().default(false),
  })
  .superRefine((query, context) => {
    if (
      query.effectiveDateFrom &&
      query.effectiveDateThrough &&
      query.effectiveDateFrom > query.effectiveDateThrough
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveDateThrough'],
        message: 'The end of the effective date range must not precede its start.',
      });
    }

    if (
      query.dateStatus === 'unknown' &&
      (query.effectiveDateFrom !== undefined || query.effectiveDateThrough !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dateStatus'],
        message: 'A date range can only be used with entries that have a known date.',
      });
    }
  });

export const ManualHistoryEvidenceSchema = z.strictObject({
  id: z.string().min(1),
  sourceEntryId: RecordIdSchema,
  kind: ManualHistoryKindSchema,
  text: NonEmptyTextSchema,
  effectiveDate: ManualHistoryDateSchema,
  recordedAt: TimestampSchema,
  provenance: ManualHistoryProvenanceSchema,
  reviewState: ReviewStateSchema,
  supersedesId: RecordIdSchema.optional(),
  correctionNote: NonEmptyTextSchema.optional(),
});

export type ManualHistoryKind = z.infer<typeof ManualHistoryKindSchema>;
export type ManualHistoryDate = z.infer<typeof ManualHistoryDateSchema>;
export type ManualHistoryProvenance = z.infer<typeof ManualHistoryProvenanceSchema>;
export type ManualHistoryEntry = z.infer<typeof ManualHistoryEntrySchema>;
export type ManualHistoryCreateInput = z.input<typeof ManualHistoryCreateInputSchema>;
export type ManualHistoryCorrectionInput = z.input<typeof ManualHistoryCorrectionInputSchema>;
export type ManualHistoryQuery = z.input<typeof ManualHistoryQuerySchema>;
export type ParsedManualHistoryQuery = z.output<typeof ManualHistoryQuerySchema>;
export type ManualHistoryEvidence = z.infer<typeof ManualHistoryEvidenceSchema>;

export function createManualHistoryEntry(input: ManualHistoryCreateInput): ManualHistoryEntry {
  const parsed = ManualHistoryCreateInputSchema.parse(input);
  return ManualHistoryEntrySchema.parse({
    ...parsed,
    ingestedAt: parsed.ingestedAt ?? parsed.recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
}

export function correctManualHistoryEntry(
  previous: ManualHistoryEntry,
  input: ManualHistoryCorrectionInput,
  metadata: { id: string; recordedAt: string; ingestedAt?: string },
): ManualHistoryEntry {
  const prior = ManualHistoryEntrySchema.parse(previous);
  const correction = ManualHistoryCorrectionInputSchema.parse(input);
  return createManualHistoryEntry({
    ...metadata,
    ...correction,
    supersedesId: prior.id,
  });
}

export function toManualHistoryEvidence(entry: ManualHistoryEntry): ManualHistoryEvidence {
  const parsed = ManualHistoryEntrySchema.parse(entry);
  return ManualHistoryEvidenceSchema.parse({
    id: 'manual-history-evidence:' + parsed.id,
    sourceEntryId: parsed.id,
    kind: parsed.kind,
    text: parsed.title + '\n' + parsed.details,
    effectiveDate: parsed.effectiveDate,
    recordedAt: parsed.recordedAt,
    provenance: parsed.provenance,
    reviewState: parsed.reviewState,
    ...(parsed.supersedesId ? { supersedesId: parsed.supersedesId } : {}),
    ...(parsed.correctionNote ? { correctionNote: parsed.correctionNote } : {}),
  });
}
