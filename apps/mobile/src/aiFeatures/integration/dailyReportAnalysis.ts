import { isRecordedWorkout } from '../../healthEvidence/healthContext/dailyReportBehaviorHistory';
import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from './dailyReportGuidance';
import { dailyReportActionCandidates } from './dailyReportActions';
import {
  applyDailyReportFocus,
  composeDailyReportFocus,
} from './dailyReportFocus';
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
  history: readonly (Claim & { materialComparison?: boolean })[],
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
  const candidates = dailyReportActionCandidates(values, sources);
  const actions = candidates.map(({ text, sourceReferences }) => ({
    text,
    sourceReferences,
  }));
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
  // Count distinct validated workout records already in this snapshot. No
  // step total, historical day, plan, or absence is a workout observation.
  const workouts = new Map<string, Claim['sourceReferences'][number]>();
  values.forEach((value, index) => {
    if (!isRecordedWorkout(value)) return;
    const source = sources[index];
    if (source?.source !== value.kind || source.recordId !== value.record.id)
      throw new Error('Workout source snapshot mismatch.');
    workouts.set(source.recordId, {
      source: source.source,
      recordId: source.recordId,
    });
  });
  const recorded = workouts.size
    ? [
        {
          text: t('dailyReport.activity.recordedWorkout', {
            count: workouts.size,
          }),
          sourceReferences: [...workouts.values()],
        },
      ]
    : [];
  return applyDailyReportFocus(
    [
      ...reviewedSection(priority, 'priority'),
      ...section([...recorded, ...sleep], 'patterns'),
      ...section(
        generated.filter(
          item => item.kind !== 'action' || !reviewed.has(item.text),
        ),
        'model',
      ),
      ...reviewedSection(actions, 'actions'),
      ...section(history, 'history'),
      ...section(dailyReportSynthesis(values, sources, selected), 'patterns'),
      ...section(plans, 'plans'),
    ],
    composeDailyReportFocus({
      priority,
      candidates,
      comparisons: [
        ...history.filter(item => item.materialComparison === true),
        ...dailyReportSynthesis(values, sources, selected, true),
      ],
      generated,
      firstSource: sources[0],
    }),
  );
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
