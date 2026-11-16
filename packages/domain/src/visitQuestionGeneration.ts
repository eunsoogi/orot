import { z } from 'zod';
import { RecordIdSchema } from './common';

/** Closed historical caveats are local review metadata, never new clinical evidence. */
export const VisitQuestionCaveatSchema = z.enum([
  'incomplete_coverage',
  'truncated_results',
  'conflicting_records',
  'insufficient_evidence',
  'reviewed_memory_unavailable',
  'no_matching_reviewed_memory',
  'public_search_not_retained',
  'public_search_consent_required',
  'public_search_empty',
  'public_search_offline',
  'public_search_failed',
  'public_search_not_configured',
  'public_search_unsupported',
  'public_search_unavailable',
]);

const RevisionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Digests identify versions without retaining deleted source plaintext or granting read access. */
export const VisitQuestionGenerationSchema = z.strictObject({
  version: z.literal(1),
  caveats: z.array(VisitQuestionCaveatSchema).max(14),
  sources: z
    .array(
      z.strictObject({
        sourceKind: z.enum(['personal_record', 'reviewed_memory', 'generated_artifact']),
        sourceId: RecordIdSchema.max(512),
        evidenceId: RecordIdSchema.max(512),
        sourceDigest: RevisionDigestSchema,
        evidenceDigest: RevisionDigestSchema,
      }),
    )
    .max(6),
});
export type VisitQuestionGeneration = z.infer<typeof VisitQuestionGenerationSchema>;
export type VisitQuestionCaveat = z.infer<typeof VisitQuestionCaveatSchema>;
