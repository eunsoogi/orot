import { z } from 'zod';
import { RecordIdSchema, TimestampSchema, compareTimestamps } from './common';
import { SymptomEntrySchema, SymptomEntryStatusSchema } from './records';
import type { SymptomEntry, SymptomEntryStatus } from './records';

const NonEmptyTextSchema = z.string().trim().min(1);
const SeveritySchema = z.number().int().min(0).max(10);

const CreateSymptomEntryFieldsSchema = z.strictObject({
  id: RecordIdSchema,
  onsetAt: TimestampSchema,
  recordedAt: TimestampSchema,
  ingestedAt: TimestampSchema.optional(),
  description: NonEmptyTextSchema,
  bodySite: NonEmptyTextSchema.optional(),
  severity: SeveritySchema.optional(),
});

export const CreateSymptomEntryInputSchema = z.discriminatedUnion('status', [
  CreateSymptomEntryFieldsSchema.extend({ status: z.literal('active') }),
  CreateSymptomEntryFieldsSchema.extend({
    status: z.literal('resolved'),
    resolvedAt: TimestampSchema,
  }),
]);

export type CreateSymptomEntryInput = z.infer<typeof CreateSymptomEntryInputSchema>;

export const EditSymptomEntryInputSchema = z.strictObject({
  description: NonEmptyTextSchema.optional(),
  bodySite: NonEmptyTextSchema.nullable().optional(),
  severity: SeveritySchema.nullable().optional(),
}).superRefine((changes, context) => {
  if (Object.values(changes).every(value => value === undefined)) {
    context.addIssue({ code: 'custom', message: 'Provide at least one symptom change.' });
  }
});

export type EditSymptomEntryInput = z.infer<typeof EditSymptomEntryInputSchema>;

export const SymptomEntryFilterSchema = z.strictObject({
  status: SymptomEntryStatusSchema.optional(),
  fromOnsetAt: TimestampSchema.optional(),
  throughOnsetAt: TimestampSchema.optional(),
}).superRefine((filter, context) => {
  if (
    filter.fromOnsetAt &&
    filter.throughOnsetAt &&
    compareTimestamps(filter.fromOnsetAt, filter.throughOnsetAt) > 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['throughOnsetAt'],
      message: 'The end of an onset range must not precede its start.',
    });
  }
});

export type SymptomEntryFilter = z.infer<typeof SymptomEntryFilterSchema>;

export function createSymptomEntry(input: CreateSymptomEntryInput): SymptomEntry {
  const parsed = CreateSymptomEntryInputSchema.parse(input);
  return SymptomEntrySchema.parse({
    id: parsed.id,
    effectiveAt: parsed.onsetAt,
    recordedAt: parsed.recordedAt,
    ingestedAt: parsed.ingestedAt ?? parsed.recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: parsed.description,
    ...(parsed.bodySite === undefined ? {} : { bodySite: parsed.bodySite }),
    ...(parsed.severity === undefined ? {} : { severity: parsed.severity }),
    status: parsed.status,
    ...(parsed.status === 'resolved' ? { resolvedAt: parsed.resolvedAt } : {}),
  });
}

export function editSymptomEntry(
  entry: SymptomEntry,
  changes: EditSymptomEntryInput,
): SymptomEntry {
  const current = SymptomEntrySchema.parse(entry);
  const parsedChanges = EditSymptomEntryInputSchema.parse(changes);
  const updated: Record<string, unknown> = { ...current };

  if (parsedChanges.description !== undefined) updated.description = parsedChanges.description;
  if (parsedChanges.bodySite !== undefined) {
    if (parsedChanges.bodySite === null) delete updated.bodySite;
    else updated.bodySite = parsedChanges.bodySite;
  }
  if (parsedChanges.severity !== undefined) {
    if (parsedChanges.severity === null) delete updated.severity;
    else updated.severity = parsedChanges.severity;
  }

  return SymptomEntrySchema.parse(updated);
}

export function resolveSymptomEntry(entry: SymptomEntry, resolvedAt: string): SymptomEntry {
  const current = SymptomEntrySchema.parse(entry);
  if (current.status === 'resolved') throw new Error('A resolved symptom cannot be resolved again.');
  return SymptomEntrySchema.parse({ ...current, status: 'resolved', resolvedAt });
}

export function filterSymptomEntries(
  entries: SymptomEntry[],
  filter: SymptomEntryFilter = {},
): SymptomEntry[] {
  const parsedFilter = SymptomEntryFilterSchema.parse(filter);
  return entries
    .map(entry => SymptomEntrySchema.parse(entry))
    .filter(entry => {
      if (parsedFilter.status && entry.status !== parsedFilter.status) return false;
      if (
        parsedFilter.fromOnsetAt &&
        compareTimestamps(entry.effectiveAt, parsedFilter.fromOnsetAt) < 0
      ) return false;
      if (
        parsedFilter.throughOnsetAt &&
        compareTimestamps(entry.effectiveAt, parsedFilter.throughOnsetAt) > 0
      ) return false;
      return true;
    })
    .sort((left, right) =>
      compareTimestamps(right.effectiveAt, left.effectiveAt) || left.id.localeCompare(right.id),
    );
}

export type { SymptomEntry, SymptomEntryStatus };
