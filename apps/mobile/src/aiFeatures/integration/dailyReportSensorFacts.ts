import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { visibleValue } from './evidenceSourceValues';
import { dailyReportFacts } from './dailyReportFacts';
import {
  isBulkSensorObservation,
  summarizeProviderObservations,
  type ProviderObservationSummary,
} from './providerObservationProjection';

type SensorReportFact = ReturnType<typeof dailyReportFacts>[number] & {
  sensorSummary?: ProviderObservationSummary;
};

/** A model fact owns all of its local members. Indexes never double as raw-row indexes
 * after sensor aggregation; symptoms and medication facts retain their original text. */
export function dailyReportSensorFacts(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
) {
  const original = dailyReportFacts(values, sources);
  const groups = summarizeProviderObservations(
    values.filter(isBulkSensorObservation),
  );
  const byId = new Map(
    values.flatMap((value, index) =>
      isBulkSensorObservation(value) ? [[value.record.id, index] as const] : [],
    ),
  );
  const groupsByFirst = new Map<number, (typeof groups)[number]>();
  const grouped = new Set<number>();
  for (const group of groups) {
    const indexes = group.memberIds.map(id => {
      const index = byId.get(id);
      if (index === undefined || !isBulkSensorObservation(values[index]!))
        throw new Error('Sensor summary has an unknown source.');
      grouped.add(index);
      return index;
    });
    if (!indexes.length) throw new Error('Sensor summary has no sources.');
    groupsByFirst.set(
      indexes.reduce((first, index) => Math.min(first, index)),
      group,
    );
  }
  const facts: SensorReportFact[] = [];
  const sourceIndexes: number[][] = [];
  for (const [index, fact] of original.entries()) {
    const group = groupsByFirst.get(index);
    if (group) {
      const indexes = group.memberIds.map(id => byId.get(id)!);
      facts.push({
        text: sensorSummaryText(group.content),
        modelText: JSON.stringify(group.content),
        sensorSummary: group.content,
        sourceReferences: indexes.map(member => ({
          source: sources[member]!.source,
          recordId: sources[member]!.recordId,
        })),
      });
      sourceIndexes.push(indexes);
    } else if (!grouped.has(index)) {
      // No fallback may leak a sensor row when an aggregate cannot be produced.
      if (isBulkSensorObservation(values[index]!))
        throw new Error('Sensor source is missing its local summary.');
      facts.push(fact);
      sourceIndexes.push([index]);
    }
  }
  return { facts, sourceIndexes };
}

/** Local presentation describes a retrieved subset, never a clinical normal range. */
function sensorSummaryText(summary: ProviderObservationSummary): string {
  const display = (value: number) => Number(value.toFixed(4));
  const unit = summary.unit === 'count/min' ? '회/분' : (summary.unit ?? '');
  return [
    `${visibleValue(summary.concept, 'concept') ?? summary.concept}: 조회한 기록 ${summary.sampleCount}개`,
    `${summary.period.fromInclusive} ~ ${summary.period.toInclusive}`,
    ...(summary.statistics
      ? [
          `최솟값 ${display(summary.statistics.minimum)}, 최댓값 ${display(summary.statistics.maximum)}, 평균 ${display(summary.statistics.mean)} ${unit}`,
        ]
      : []),
    ...(summary.sleep
      ? [
          `관측 수면 구간 합계 ${summary.sleep.asleepSeconds}초 (단계 중첩 ${summary.sleep.overlappingStageSeconds}초)`,
        ]
      : []),
    ...(summary.limitations.includes('conflicting_values_at_same_instant')
      ? ['같은 시각의 값이 서로 달라 어느 기록이 정확한지 확인이 필요해요.']
      : []),
    '조회한 자료의 기술 통계이며 전체 기간의 완전한 기록이나 정상 범위·진단을 뜻하지 않아요.',
  ].join(' · ');
}
