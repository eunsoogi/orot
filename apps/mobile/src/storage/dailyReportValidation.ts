import {
  compareTimestamps,
  DailyReportContextSchema,
  DailyReportGenerationResultSchema,
} from '@orot/domain';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Validate a completion against the immutable input before any persistence attempt. */
export function validateDailyReportCompletion(
  context: unknown,
  result: unknown,
) {
  const parsedContext = DailyReportContextSchema.safeParse(context);
  const parsedResult = DailyReportGenerationResultSchema.safeParse(result);
  if (
    !parsedContext.success ||
    !parsedResult.success ||
    parsedResult.data.status !== 'completed'
  )
    return null;
  const input = parsedContext.data;
  const report = parsedResult.data.report;
  if (
    stableJson(input.identity) !== stableJson(report.identity) ||
    compareTimestamps(report.generatedAt, input.generationCutoff) < 0 ||
    stableJson(input.sourceSnapshot.coverage.map(stableJson).sort()) !==
      stableJson(report.coverage.map(stableJson).sort())
  )
    return null;
  // A claim may cite only an admitted input, including the source namespace.
  const admitted = new Set(
    input.sourceSnapshot.records.map(record =>
      stableJson([record.source, record.recordId]),
    ),
  );
  if (
    [...report.observations, ...report.supportedContext].some(claim =>
      claim.sourceReferences.some(
        reference =>
          !admitted.has(stableJson([reference.source, reference.recordId])),
      ),
    )
  )
    return null;
  return { context: input, report };
}
