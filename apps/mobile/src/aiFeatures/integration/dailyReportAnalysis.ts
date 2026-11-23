import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from './dailyReportGuidance';
import { dailyReportActions } from './dailyReportActions';
import { dailyReportSynthesis } from './dailyReportSynthesis';
import type { ProjectedReportModelClaim } from './dailyReportModelAnalysis';
import { t } from '../../i18n';

type Claim = DailyReportOutput['supportedContext'][number];

/** Compose reviewed claims, not new clinical assertions. Safety guidance is always
 * first, independent of model selection. Keep reviewed actions in their own
 * sections. A duplicate AI choice can reference other evidence, but it must
 * never change the reviewed claim's citations. */
export function dailyReportAnalysis(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  selected: readonly number[],
  history: readonly Claim[],
  plans: readonly Claim[],
  generated: readonly ProjectedReportModelClaim[] = [],
  sleep: readonly Claim[] = [],
): Claim[] {
  const section = (
    items: readonly Claim[],
    name: NonNullable<Claim['section']>,
  ) =>
    items.map(({ text, sourceReferences }) => ({
      text,
      sourceReferences,
      section: name,
    }));
  const priority = dailyReportGuidance(values, sources);
  const actions = dailyReportActions(values, sources);
  const reviewed = new Set([...priority, ...actions].map(item => item.text));
  const modelSelected = generated.filter(
    item => item.kind === 'action' && reviewed.has(item.text),
  );
  const reviewedSection = (
    items: readonly Claim[],
    name: 'priority' | 'actions',
  ) =>
    section(items, name).flatMap(claim => {
      const key = (ref: Claim['sourceReferences'][number]) =>
        JSON.stringify([ref.source, ref.recordId]);
      const authority = new Set(claim.sourceReferences.map(key));
      const extra = new Map(
        modelSelected
          .filter(item => item.text === claim.text)
          .flatMap(item => item.sourceReferences)
          .map(ref => [key(ref), ref] as const)
          .filter(([identity]) => !authority.has(identity)),
      );
      return extra.size
        ? [
            claim,
            {
              text: t('dailyReport.analysis.modelActionEvidence'),
              sourceReferences: [...extra.values()],
              section: 'model' as const,
            },
          ]
        : [claim];
    });
  return [
    ...reviewedSection(priority, 'priority'),
    ...section(
      generated.filter(
        item => item.kind !== 'action' || !reviewed.has(item.text),
      ),
      'model',
    ),
    ...reviewedSection(actions, 'actions'),
    ...section(history, 'history'),
    ...section(sleep, 'patterns'),
    ...section(dailyReportSynthesis(values, sources, selected), 'patterns'),
    ...section(plans, 'plans'),
  ];
}

/** Reviewed guidance owns its own section, even if the model picks it as a highlight. */
export function reportObservations(
  facts: readonly (DailyReportOutput['observations'][number] & {
    role?: 'guidance' | 'evidence';
  })[],
  required: readonly number[],
  selected: readonly number[],
): DailyReportOutput['observations'] {
  const chosen = [...new Set([...required, ...selected])].filter(
    index => facts[index] && facts[index].role !== 'guidance',
  );
  if (!chosen.length) {
    const firstEvidence = facts.findIndex(fact => fact.role !== 'guidance');
    if (firstEvidence !== -1) chosen.push(firstEvidence);
  }
  return chosen.slice(0, 8).map(index => ({
    text: facts[index]!.text,
    sourceReferences: facts[index]!.sourceReferences,
  }));
}
