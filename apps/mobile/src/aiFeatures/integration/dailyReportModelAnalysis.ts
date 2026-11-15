import {
  DailyReportModelResponseSchema,
  type DailyReportModelAnalysis,
} from '@orot/domain';
export type ReportModelAnalysis = DailyReportModelAnalysis;
import type { DailyReportOutput } from '@orot/domain';
import { t } from '../../i18n';

export type ReportModelFact = { text: string; role?: 'evidence' | 'guidance' };
/** Structural checks establish source membership, not medical truth. Conservative
 * lexical/numeric rejection only catches obvious unsupported claims; the UI must
 * still identify generated interpretation and preserve reviewed guidance. */
export function parseReportModelResponse(
  value: unknown,
  facts: readonly ReportModelFact[],
  allowAnalysis: boolean,
) {
  // Validate selection independently: even malformed unsolicited analysis must
  // not prevent reviewed urgent guidance from reaching the saved report.
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => key !== 'indexes' && key !== 'analysis')
  )
    return null;
  const selection = DailyReportModelResponseSchema.shape.indexes.safeParse(
    (value as { indexes?: unknown }).indexes,
  );
  if (!selection.success) return null;
  const validIndexes = (items: readonly number[]) =>
    new Set(items).size === items.length &&
    items.every(index => index < facts.length);
  if (!validIndexes(selection.data)) return null;
  const fallback = {
    indexes: selection.data,
    analysis: [] as ReportModelAnalysis[],
  };
  if (!allowAnalysis) return fallback;
  const parsed = DailyReportModelResponseSchema.safeParse(value);
  if (!parsed.success) return fallback;
  const analysis = parsed.data.analysis ?? [];

  for (const item of analysis) {
    if (!validIndexes(item.evidenceIndexes)) return fallback;
    if (item.kind === 'action') {
      if (
        facts[item.guidanceIndex]?.role !== 'guidance' ||
        !item.evidenceIndexes.includes(item.guidanceIndex)
      )
        return fallback;
      continue;
    }
    if (!item.evidenceIndexes.some(index => facts[index]?.role === 'evidence'))
      return fallback;
    const cited = item.evidenceIndexes
      .map(index => facts[index]!.text)
      .join(' ');
    const numbers = new Set(cited.match(/\d+(?:\.\d+)?/g) ?? []);
    if (
      (item.text.match(/\d+(?:\.\d+)?/g) ?? []).some(
        number => !numbers.has(number),
      )
    )
      return fallback;
    // Reject obvious certainty/treatment directives; this is not a semantic verifier.
    if (
      /https?:|www\.|진단(?:입니다|됩니다|해요)|정상입니다|이상(?:이)?\s*없|문제(?:가)?\s*없|완치|복용(?:량|을).*(?:늘리|줄이|중단)|약(?:을|은).*(?:끊|중단)|you have|diagnosed with|stop taking|double.*dose|no (?:health )?problems/i.test(
        item.text,
      )
    )
      return fallback;
  }
  return { indexes: parsed.data.indexes, analysis };
}

/** Map transient model indexes back to exact admitted sources. Generated prose
 * is durably labelled, including when later read through the report artifact. */
export function reportModelClaims(
  analysis: readonly ReportModelAnalysis[],
  facts: readonly {
    text: string;
    sourceReferences: DailyReportOutput['observations'][number]['sourceReferences'];
  }[],
): DailyReportOutput['supportedContext'] {
  return analysis.map(item => {
    const sourceReferences = new Map(
      item.evidenceIndexes.flatMap(index =>
        facts[index]!.sourceReferences.map(
          ref => [JSON.stringify(ref), ref] as const,
        ),
      ),
    );
    return {
      text:
        item.kind === 'interpretation'
          ? t('dailyReport.analysis.generated', { text: item.text })
          : facts[item.guidanceIndex]!.text,
      section: 'model' as const,
      sourceReferences: [...sourceReferences.values()],
    };
  });
}

export type ReportModelContext = {
  localDate: string;
  timeZone: string;
  generationCutoff: string;
  coverage: readonly {
    source: string;
    status: string;
    limitationCodes: readonly string[];
  }[];
};
