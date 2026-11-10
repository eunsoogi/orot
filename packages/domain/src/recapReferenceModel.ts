import { z } from 'zod';
import { guidedSchema } from './recapModel';

/** Model-selected references are resolved against the current request, never searched in text. */
export const RecapReferenceOutputSchema = z.strictObject({
  recordingSourceId: z.string().min(1),
  appointmentId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  questions: z
    .array(
      z.strictObject({
        questionId: z.string().min(1),
        status: z.enum(['evidence_found', 'not_found', 'indeterminate']),
        questionRefs: z.array(z.string().min(1)).max(16),
        answers: z
          .array(
            z.strictObject({
              refs: z.array(z.string().min(1)).min(1).max(16),
              summary: z.string().trim().min(1).max(4000),
              inferredRole: z.enum(['likely_clinician', 'uncertain']),
              speakerUncertainty: z.string().trim().min(1).max(1000),
            }),
          )
          .max(16),
      }),
    )
    .min(1)
    .max(5),
});

export const recapReferenceJsonSchema = guidedSchema(z.toJSONSchema(RecapReferenceOutputSchema));
