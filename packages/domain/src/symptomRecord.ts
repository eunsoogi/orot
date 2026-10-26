import { z } from 'zod';
import { RecordMetadataSchema, TimestampSchema, compareTimestamps } from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
export const SymptomEntryStatusSchema = z.enum(['active', 'resolved']);

const SymptomEntryRecordSchema = RecordMetadataSchema.safeExtend({
  description: NonEmptyTextSchema,
  bodySite: NonEmptyTextSchema.optional(),
  severity: z.number().int().min(0).max(10).optional(),
  status: SymptomEntryStatusSchema,
  resolvedAt: TimestampSchema.optional(),
}).superRefine((symptom, context) => {
  if (symptom.status === 'active' && symptom.resolvedAt !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['resolvedAt'],
      message: 'An active symptom cannot have a resolution timestamp.',
    });
  }
  if (symptom.status === 'resolved' && symptom.resolvedAt === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['resolvedAt'],
      message: 'A resolved symptom must have a resolution timestamp.',
    });
  }
  if (symptom.resolvedAt && compareTimestamps(symptom.resolvedAt, symptom.effectiveAt) < 0) {
    context.addIssue({
      code: 'custom',
      path: ['resolvedAt'],
      message: 'resolvedAt must not precede effectiveAt.',
    });
  }
});

function normalizeLegacySymptomStatus(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const symptom = value as Record<string, unknown>;
  if ('status' in symptom) return value;
  return {
    ...symptom,
    status: symptom.resolvedAt === undefined ? 'active' : 'resolved',
  };
}

/** Adds a status when parsing pre-status records; no stored rows need migration. */
export const SymptomEntrySchema = z.preprocess(
  normalizeLegacySymptomStatus,
  SymptomEntryRecordSchema,
);

export type SymptomEntryStatus = z.infer<typeof SymptomEntryStatusSchema>;
