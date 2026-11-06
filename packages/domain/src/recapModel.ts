import { z } from 'zod';
import { RecordIdSchema } from './common';
import { RecapEvidenceSchema } from './recap';

const ModelEvidenceSchema = z.strictObject({
  segmentId: RecapEvidenceSchema.shape.segmentId,
  startOffset: RecapEvidenceSchema.shape.startOffset,
  endOffset: RecapEvidenceSchema.shape.endOffset,
  quote: RecapEvidenceSchema.shape.quote,
});
/** Wire output repeats trusted identity so foreign or stale responses fail before recombination. */
export const RecapModelOutputSchema = z.strictObject({
  recordingSourceId: RecordIdSchema,
  appointmentId: RecordIdSchema,
  chunkIndex: z.number().int().nonnegative(),
  questions: z
    .array(
      z.strictObject({
        questionId: RecordIdSchema,
        status: z.enum(['evidence_found', 'not_found', 'indeterminate']),
        questionEvidence: z.array(ModelEvidenceSchema).max(16),
        answers: z
          .array(
            z.strictObject({
              quotation: z.string().min(1),
              summary: z.string().trim().min(1).max(4000),
              speaker: z.literal('unknown'),
              inferredRole: z.enum(['likely_clinician', 'uncertain']),
              speakerUncertainty: z.string().trim().min(1).max(1000),
              evidence: z.array(ModelEvidenceSchema).min(1).max(16),
            }),
          )
          .max(16),
      }),
    )
    .min(1)
    .max(5),
});

// Apple guided generation cannot express scalar length or numeric bounds; the full
// Zod schema and source checks still enforce them after every model response.
function guidedSchema(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      ['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum'].includes(key)
    )
      continue;
    if (key === 'const') result.enum = [item];
    else if (key === 'properties')
      result.properties = Object.fromEntries(
        Object.entries(item as Record<string, Record<string, unknown>>).map(([name, child]) => [
          name,
          guidedSchema(child),
        ]),
      );
    else if (key === 'items') result.items = guidedSchema(item as Record<string, unknown>);
    else result[key] = item;
  }
  return result;
}

export const recapModelJsonSchema = guidedSchema(z.toJSONSchema(RecapModelOutputSchema));
