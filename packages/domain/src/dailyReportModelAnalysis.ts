import { z } from 'zod';

/** Bounded provider response; source membership is validated against the exact request. */
const indexes = z.array(z.number().int().nonnegative()).min(1).max(8);
const analysisItem = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('interpretation'),
    text: z.string().trim().min(1).max(800),
    evidenceIndexes: indexes,
  }),
  z.strictObject({
    kind: z.literal('action'),
    guidanceIndex: z.number().int().nonnegative(),
    evidenceIndexes: indexes,
  }),
]);
export const DailyReportModelResponseSchema = z.strictObject({
  indexes,
  // Old index-only providers remain a deterministic fallback, not generated interpretation.
  analysis: z.array(analysisItem).max(4).optional(),
});
export type DailyReportModelAnalysis = z.infer<typeof analysisItem>;
