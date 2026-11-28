import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { baselineMeasurement } from '../../healthEvidence/healthContext/dailyReportBaseline';
import {
  dayFormatter,
  dateKey,
} from '../../healthEvidence/healthContext/calendarDate';
import { t } from '../../i18n';
import { visibleValue } from './evidenceSourceValues';

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const display = (value: number) => Number(value.toFixed(2)).toString();

/** Descriptive personal context, never a normal range or a diagnosis. Each observed
 * local day has equal weight, so a day with more sensor samples cannot dominate.
 * Three observed days is a display sufficiency rule, not a clinical threshold. */
export function dailyReportPersonalBaseline(
  today: readonly LocalHealthEvidenceRecord[],
  history: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  timeZone: string,
) {
  const formatter = dayFormatter(timeZone);
  const all = [...today, ...history];
  const groups = new Map<
    string,
    {
      today: number[];
      past: Map<string, number[]>;
      ids: Set<string>;
      times: Map<string, number>;
      conflict: boolean;
      concept: string;
      unit: string;
    }
  >();
  for (const [index, item] of all.entries()) {
    const point = baselineMeasurement(item);
    if (!point) continue;
    const group = groups.get(point.key) ?? {
      today: [] as number[],
      past: new Map<string, number[]>(),
      ids: new Set<string>(),
      times: new Map<string, number>(),
      conflict: false,
      concept: point.concept,
      unit: point.unit,
    };
    const instant = new Date(point.at).toISOString();
    if (group.times.has(instant) && group.times.get(instant) !== point.amount)
      group.conflict = true;
    // Identical observations at one instant add provenance, but no statistical weight.
    const duplicate = group.times.has(instant);
    group.times.set(instant, point.amount);
    group.ids.add(item.record.id);
    if (!duplicate) {
      if (index < today.length) group.today.push(point.amount);
      else {
        const day = dateKey(formatter, Date.parse(point.at));
        const values = group.past.get(day) ?? [];
        values.push(point.amount);
        group.past.set(day, values);
      }
    }
    groups.set(point.key, group);
  }
  return [...groups.values()].flatMap(group => {
    if (group.conflict || !group.today.length || group.past.size < 3) return [];
    const matching = sources.filter(
      source =>
        source.source === 'health_observation' &&
        group.ids.has(source.recordId),
    );
    if (
      new Set(matching.map(source => source.recordId)).size !== group.ids.size
    )
      throw new Error('Baseline sources do not match values.');
    const current = median(group.today);
    const pastDays = [...group.past.values()].map(median);
    const prior = median(pastDays);
    const shownCurrent = Number(display(current));
    const shownDays = pastDays.map(value => Number(display(value)));
    const low = Math.min(...shownDays);
    const high = Math.max(...shownDays);
    const concept = visibleValue(group.concept, 'concept') ?? group.concept;
    const unit =
      group.unit === 'count/min'
        ? t('dailyReport.baseline.perMinute')
        : group.unit;
    const direction = t(
      current > prior
        ? 'dailyReport.baseline.higher'
        : current < prior
          ? 'dailyReport.baseline.lower'
          : 'dailyReport.baseline.equal',
    );
    const text = t('dailyReport.baseline.comparison', {
      concept,
      today: display(current),
      baseline: display(prior),
      days: group.past.size,
      unit,
      direction,
    });
    // The main report skips ordinary within-history variation. Use the
    // displayed observed day medians, not a clinical or personal normal range.
    const outsideHistory = shownCurrent < low || shownCurrent > high;
    return [
      {
        text,
        modelText: text,
        ...(outsideHistory
          ? {
              materialComparison: true as const,
              focusText: t('dailyReport.baseline.focusComparison', {
                concept,
                today: display(current),
                low,
                high,
                unit,
                days: group.past.size,
                direction,
              }),
            }
          : {}),
        sourceReferences: sources
          .filter(
            source =>
              source.source === 'health_observation' &&
              group.ids.has(source.recordId),
          )
          .map(source => ({
            source: source.source,
            recordId: source.recordId,
          })),
      },
    ];
  });
}
