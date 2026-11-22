import type { LanguageModelRequest } from '@orot/model-runtime';
import { dailyReportModelPrompt } from './dailyReportModelPrompt';
import type {
  ReportModelContext,
  ReportModelFact,
} from './dailyReportModelAnalysis';

/** Freeze the exact fact order and role that are approved and sent to the selected model. */
export function buildDailyReportModelRequest(input: {
  readonly allowAnalysis?: boolean;
  readonly reportContext?: ReportModelContext;
  readonly facts: readonly ReportModelFact[];
}): LanguageModelRequest {
  return {
    messages: [
      {
        role: 'system',
        content: dailyReportModelPrompt(input.allowAnalysis !== false),
      },
      {
        role: 'user',
        content: JSON.stringify({
          context: input.reportContext,
          facts: input.facts.map((fact, index) => ({
            index,
            text: fact.text,
            role: fact.role ?? 'evidence',
          })),
        }),
      },
    ],
  };
}
