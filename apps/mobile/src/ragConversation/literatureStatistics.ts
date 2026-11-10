import type { EvidenceItem } from '@orot/agent-runtime';
import { t } from '../i18n';
import type { LiteratureIdentity } from './literatureCitationBinding';
import { summarizeSupportedAbstract } from './literatureQualitative';

/** Require sentence boundaries so an excerpt cannot silently drop a preceding negation. */
function completeSentence(abstract: string, span: string): boolean {
  if (!span.trim() || span !== span.trim()) return false;
  let index = abstract.indexOf(span);
  while (index >= 0) {
    const prefix = abstract.slice(0, index);
    const before = prefix.trimEnd();
    const after = abstract.slice(index + span.length).trimStart();
    if (
      (!before ||
        (/[.!?]$/u.test(before) && /\s$/u.test(prefix)) ||
        /<\/h[1-6]>$/iu.test(before)) &&
      /[.!?]$/u.test(span) &&
      (!after || /^<|^[A-Z]/u.test(after))
    )
      return true;
    index = abstract.indexOf(span, index + 1);
  }
  return false;
}

/** Require one complete metric expression; partial labels or numeric tokens must not bind. */
function completeStatisticSpan(abstract: string, span: string): boolean {
  const position = abstract.indexOf(span);
  if (position < 0 || abstract.lastIndexOf(span) !== position) return false;
  const before = abstract.slice(0, position).trimEnd();
  const after = abstract.slice(position + span.length).trimStart();
  return (
    (!before || ['(', ':', ';'].includes(before[before.length - 1])) &&
    (!after || [')', ';'].includes(after[0]))
  );
}

type StatisticMeasure = 'odds_ratio' | 'risk_ratio' | 'hazard_ratio';
interface SourceStatistic {
  measure: StatisticMeasure;
  value: string;
  confidenceInterval: string;
  confidenceLevel: 95;
}

/** Bind numeric source text only; this does not establish that it is an observed finding. */
export function validateLiteratureStatistics(
  claims: readonly unknown[],
  items: readonly EvidenceItem[],
): { status: 'valid'; statistics: SourceStatistic[] } | { status: 'invalid' } {
  const statistics: SourceStatistic[] = [];
  for (const candidate of claims) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return { status: 'invalid' };
    const c = candidate as Record<string, unknown>;
    const matches = items.filter(
      item =>
        item.sourceKind === 'external_medical' &&
        item.sourceId === 'europe-pmc' &&
        item.evidenceId === c.evidenceId &&
        item.sourceRevision === c.sourceRevision &&
        item.evidenceRevision === c.evidenceRevision,
    );
    const source = matches.length === 1 ? matches[0] : undefined;
    if (
      !source ||
      typeof c.span !== 'string' ||
      !c.span ||
      !source.content.includes(`Abstract: `) ||
      !source.content
        .split('Abstract: ')[1]
        ?.split('\nOriginal source: ')[0]
        ?.includes(c.span)
    )
      return { status: 'invalid' };
    const sourceAbstract = source.content
      .split('Abstract: ')[1]
      ?.split('\nOriginal source: ')[0];
    if (!sourceAbstract || !completeStatisticSpan(sourceAbstract, c.span))
      return { status: 'invalid' };
    if (typeof c.value !== 'string' || typeof c.confidenceInterval !== 'string')
      return { status: 'invalid' };
    // Recognize explicit measure labels only; unknown statistical formats fail closed.
    const match =
      /^(?:pooled\s+)?(OR|odds ratio|RR|risk ratio|HR|hazard ratio)\s*[:=]?\s*(\d+(?:\.\d+)?),?\s*95%\s*CI\s*[:=]?\s*(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?)$/iu.exec(
        c.span.trim(),
      );
    const kind = match?.[1].toLowerCase();
    const expected =
      kind === 'or' || kind === 'odds ratio'
        ? 'odds_ratio'
        : kind === 'rr' || kind === 'risk ratio'
          ? 'risk_ratio'
          : 'hazard_ratio';
    if (
      !match ||
      c.measure !== expected ||
      match[2] !== c.value ||
      match[3] !== c.confidenceInterval
    )
      return { status: 'invalid' };
    // A verbatim interval can still be malformed; never repair its bounds silently.
    const bounds = match[3].split(/[-–]/u).map(value => Number(value.trim()));
    if (bounds.some(value => !Number.isFinite(value)) || bounds[0] > bounds[1])
      return { status: 'invalid' };
    statistics.push({
      measure: expected,
      value: c.value,
      confidenceInterval: c.confidenceInterval,
      confidenceLevel: 95,
    });
  }
  return { status: 'valid', statistics };
}

/** Render only the checked numeric fields, independently of source narrative. */
function formatStatistics(statistics: readonly SourceStatistic[]): string {
  const labels: Record<StatisticMeasure, string> = {
    odds_ratio: t('externalMedicalEvidence.literature.statistic.oddsRatio'),
    risk_ratio: t('externalMedicalEvidence.literature.statistic.riskRatio'),
    hazard_ratio: t('externalMedicalEvidence.literature.statistic.hazardRatio'),
  };
  return statistics
    .map(s =>
      t('externalMedicalEvidence.literature.statisticLine', {
        label: labels[s.measure],
        value: s.value,
        confidenceLevel: s.confidenceLevel,
        confidenceInterval: s.confidenceInterval,
      }),
    )
    .join('\n');
}

/** Render only exact abstract excerpts and statistics checked against the same source revision. */
export function renderLiteratureAnswer(
  value: unknown,
  items: readonly EvidenceItem[],
): { answer: string; references: LiteratureIdentity[] } | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5)
    return undefined;
  const lines: string[] = [];
  const references: LiteratureIdentity[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return undefined;
    const c = entry as Record<string, unknown>;
    const matches = items.filter(
      item =>
        item.sourceKind === 'external_medical' &&
        item.sourceId === 'europe-pmc' &&
        item.evidenceId === c.evidenceId &&
        item.sourceRevision === c.sourceRevision &&
        item.evidenceRevision === c.evidenceRevision,
    );
    const source = matches.length === 1 ? matches[0] : undefined;
    const abstract = source?.content
      .split('Abstract: ')[1]
      ?.split('\nOriginal source: ')[0];
    if (
      !source ||
      !abstract ||
      abstract === 'unavailable' ||
      typeof c.populationSpan !== 'string' ||
      !c.populationSpan.trim() ||
      !completeSentence(abstract, c.populationSpan) ||
      typeof c.resultSpan !== 'string' ||
      typeof c.statisticSpan !== 'string' ||
      typeof c.limitationSpan !== 'string' ||
      (c.limitationSpan !== '' && !completeSentence(abstract, c.limitationSpan))
    )
      return undefined;
    if (!completeSentence(abstract, c.resultSpan)) return undefined;
    const qualitative =
      c.measure === 'qualitative' &&
      c.value === '' &&
      c.confidenceInterval === '' &&
      c.statisticSpan === '';
    if (
      !qualitative &&
      (!c.statisticSpan || !c.resultSpan.includes(c.statisticSpan))
    )
      return undefined;
    const result = qualitative
      ? undefined
      : validateLiteratureStatistics([{ ...c, span: c.statisticSpan }], items);
    if (!qualitative && result?.status !== 'valid') return undefined;
    const summary = summarizeSupportedAbstract(
      abstract,
      c.populationSpan,
      c.resultSpan,
      qualitative ? '' : c.statisticSpan,
    );
    references.push({
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      evidenceId: source.evidenceId,
      evidenceRevision: source.evidenceRevision,
    });
    // One complete source sentence may serve several requested roles; display it once.
    const excerpts = [
      ...new Set(
        [c.populationSpan, c.resultSpan, c.limitationSpan].filter(Boolean),
      ),
    ]
      .map(span =>
        t('externalMedicalEvidence.literature.selectedSentence', { span }),
      )
      .join('\n');
    const statisticText =
      result?.status === 'valid'
        ? `\n${t('externalMedicalEvidence.literature.statisticsHeading', { statistics: formatStatistics(result.statistics) })}`
        : '';
    const verificationText =
      result?.status === 'valid'
        ? `\n${summary ? t('externalMedicalEvidence.literature.statisticsOutcomeUnknown') : t('externalMedicalEvidence.literature.sentenceRolesAndOutcomeUnknown')}`
        : !summary
          ? `\n${t('externalMedicalEvidence.literature.sentenceMeaningUnknown')}`
          : '';
    lines.push(
      `${summary ? `${summary}\n` : ''}${excerpts}${statisticText}${verificationText}\n${t('externalMedicalEvidence.literature.relevanceAndLimitsUnknown')}`,
    );
  }
  return { answer: lines.join('\n\n'), references };
}
