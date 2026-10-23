import { z } from 'zod';
import { compareTimestamps, TimestampSchema } from './common';

/** Fixed period provenance survives record backup without retaining every contributing health sample. */
export const VisitQuestionHealthContextSourceSchema = z.strictObject({
  scope: z.strictObject({
    kind: z.literal('health_context_period'),
    version: z.literal(1),
    topic: z.enum(['medications', 'measurements', 'activity', 'sleep', 'symptoms']),
    window: z
      .strictObject({
        fromInclusive: TimestampSchema,
        toExclusive: TimestampSchema,
        timeZone: z
          .string()
          .min(1)
          .refine((value) => {
            try {
              // Resolve through Intl's host timezone database while retaining its canonical validation.
              return Boolean(
                new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone,
              );
            } catch {
              return false;
            }
          }, 'An IANA time zone is required.'),
      })
      .refine(
        (window) =>
          compareTimestamps(window.fromInclusive, window.toExclusive) < 0 &&
          Date.parse(window.toExclusive) - Date.parse(window.fromInclusive) <= 91 * 86_400_000,
        'A health period must advance within ninety local calendar days.',
      ),
  }),
  revision: z.string().min(1),
  deletionGeneration: z.number().int().nonnegative().safe(),
});

export type VisitQuestionHealthContextSource = z.infer<
  typeof VisitQuestionHealthContextSourceSchema
>;
