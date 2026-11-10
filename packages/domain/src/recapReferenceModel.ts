import { z } from 'zod';
import { guidedSchema } from './recapModel';

/** Model-selected references are resolved against the current request, never searched in text. */
const speechRefs = z.array(z.string().min(1)).max(16);
export const RecapReferenceOutputSchema = z.strictObject({
  requestRef: z.string().min(1),
  items: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('question'),
          preparedQuestionRef: z.string().min(1),
          status: z.enum(['evidence_found', 'not_found', 'indeterminate']),
          speechRefs,
        }),
        z.strictObject({
          kind: z.literal('answer'),
          preparedQuestionRef: z.string().min(1),
          speechRefs: speechRefs.min(1),
          utteranceRole: z.enum(['response', 'question', 'uncertain']),
          association: z.enum(['clear', 'ambiguous']),
          summary: z.string().trim().min(1).max(4000),
          inferredRole: z.enum(['likely_clinician', 'uncertain']),
          speakerUncertainty: z.string().trim().min(1).max(1000),
        }),
      ]),
    )
    .min(1)
    .max(85),
});

export const recapReferenceJsonSchema = guidedSchema(z.toJSONSchema(RecapReferenceOutputSchema));
