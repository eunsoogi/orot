import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { stableJson } from './evidenceUtils';
import { t } from '../../i18n';

type Interval = readonly [number, number];
const asleep = new Set([
  '1',
  '3',
  '4',
  '5',
  'asleepUnspecified',
  'asleepCore',
  'asleepDeep',
  'asleepREM',
]);
const awake = new Set(['2', 'awake']);
const inBed = new Set(['0', 'inBed']);

/** Union intervals, not stage counts. Repeated devices never contribute to one total. */
function unionMinutes(intervals: readonly Interval[]) {
  let total = 0;
  let end = -Infinity;
  for (const [start, finish] of [...intervals].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  return Math.floor(total / 60000);
}

/** Describe retained partial intervals, not sleep adequacy or a full night.
 * Use actual civil-day instants (including DST), preserving original citations.
 * Awake/asleep contradictions suppress a duration rather than choose a winner. */
export function dailyReportSleepContext(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  calendar: DailyReportCalendarWindow,
) {
  const groups = new Map<
    string,
    {
      sleep: Interval[];
      wake: Interval[];
      indexes: number[];
      unknown: boolean;
    }
  >();
  values.forEach((item, index) => {
    if (
      item.kind !== 'health_observation' ||
      !['sleep', 'HKCategoryTypeIdentifierSleepAnalysis'].includes(
        item.record.concept,
      )
    )
      return;
    const record = item.record;
    const source = sources[index];
    if (source?.source !== item.kind || source.recordId !== record.id)
      throw new Error('Sleep source snapshot mismatch.');
    const key = stableJson([
      record.provenance.origin,
      record.provenance.source,
      record.provenance.origin === 'imported' &&
      !record.provenance.source?.sourceIdentifier
        ? record.id
        : undefined,
    ]);
    const group = groups.get(key) ?? {
      sleep: [],
      wake: [],
      indexes: [],
      unknown: false,
    };
    group.indexes.push(index);
    const stage = record.value.kind === 'text' ? record.value.text : '';
    const start = Math.max(
      Date.parse(record.effectiveAt),
      Date.parse(calendar.interval.fromInclusive),
    );
    const finish = Math.min(
      Date.parse(record.endedAt ?? ''),
      Date.parse(calendar.effectiveCutoff),
    );
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(finish) ||
      finish <= start ||
      !record.endedAt ||
      Date.parse(record.endedAt) > Date.parse(calendar.effectiveCutoff)
    )
      group.unknown = true;
    else if (asleep.has(stage)) group.sleep.push([start, finish]);
    else if (awake.has(stage)) group.wake.push([start, finish]);
    else if (!inBed.has(stage)) group.unknown = true;
    groups.set(key, group);
  });
  const sourceRefs = (indexes: number[]) =>
    indexes.map(index => ({
      source: sources[index]!.source,
      recordId: sources[index]!.recordId,
    }));
  const facts = [...groups.values()].slice(0, 3).map((group, index) => {
    const conflict = group.sleep.some(([a, b]) =>
      group.wake.some(([c, d]) => a < d && c < b),
    );
    const minutes = unionMinutes(group.sleep);
    const duration = conflict
      ? t('dailyReport.sleep.conflict')
      : group.sleep.length
        ? minutes === 0
          ? t('dailyReport.sleep.shortInterval')
          : t('dailyReport.sleep.duration', {
              hours: Math.floor(minutes / 60),
              minutes: minutes % 60,
            })
        : t('dailyReport.sleep.noAsleep');
    const text = t('dailyReport.sleep.context', {
      source: index + 1,
      date: calendar.identity.localDate,
      zone: calendar.identity.timeZone,
      duration,
      unknown: group.unknown ? t('dailyReport.sleep.unknown') : '',
    });
    return {
      text,
      modelText: text,
      sourceReferences: sourceRefs(group.indexes),
    };
  });
  if (groups.size > 3) {
    const text = t('dailyReport.sleep.limitedSources');
    facts.push({
      text,
      modelText: text,
      sourceReferences: sourceRefs(
        [...groups.values()].flatMap(g => g.indexes),
      ),
    });
  }
  return facts;
}
