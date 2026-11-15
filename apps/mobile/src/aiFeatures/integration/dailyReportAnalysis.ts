import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from './dailyReportGuidance';
import { dailyReportActions } from './dailyReportActions';
import { dailyReportSynthesis } from './dailyReportSynthesis';

type Claim = DailyReportOutput['supportedContext'][number];

/** Compose reviewed claims, not new clinical assertions. Safety guidance is always
 * first, independent of model selection; no claim or citation is dropped to fit a
 * summary. Historical patterns and calendar plans remain distinct from today. */
export function dailyReportAnalysis(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  selected: readonly number[],
  history: readonly Claim[],
  plans: readonly Claim[],
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
  // Actions end with the existing coverage qualification. Keep it visible, but
  // do not invent a medication/visit heading when neither kind is present.
  const actions = dailyReportActions(values, sources);
  return [
    ...section(dailyReportGuidance(values, sources), 'priority'),
    ...section(actions.slice(0, -1), 'actions'),
    ...section(history, 'history'),
    ...section(dailyReportSynthesis(values, sources, selected), 'patterns'),
    ...section(plans, 'plans'),
    ...section(actions.slice(-1), 'limits'),
  ];
}
