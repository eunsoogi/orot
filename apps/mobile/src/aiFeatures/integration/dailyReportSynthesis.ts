import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import { compareTimestamps } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from './dailyReportFacts';

import { visibleValue } from './evidenceSourceValues';

type Claim = DailyReportOutput['supportedContext'][number];

/** Summarize observed daily patterns, not medical meaning. No reference ranges or
 * causal/diagnostic conclusions can be inferred from a day's incomplete sample.
 * The existing model selects highlights; only deterministic, cited synthesis is
 * allowed to add statements beyond their verbatim source descriptions. */
export function dailyReportSynthesis(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  selected: readonly number[],
): Claim[] {
  if (!values.length) return [];
  if (values.length !== sources.length)
    throw new Error('Snapshot source mismatch.');
  const claim = (text: string, indexes: readonly number[]): Claim => ({
    text,
    sourceReferences: [...new Set(indexes)].map(index => {
      const source = sources[index]!;
      if (
        !source ||
        source.recordId !== values[index]?.record.id ||
        source.source !== values[index]?.kind
      )
        throw new Error('Snapshot source mismatch.');
      return { source: source.source, recordId: source.recordId };
    }),
  });
  const blocked = new Set([
    ...conflictingDailyReportIndexes(values),
    ...incomparableDailyReportIndexes(values),
  ]);
  const result: Claim[] = [];
  const symptoms = values.flatMap((item, index) =>
    item.kind === 'symptom_entry' ? [{ record: item.record, index }] : [],
  );
  if (symptoms.length) {
    const active = symptoms.filter(item => item.record.status === 'active');
    const resolved = symptoms.filter(item => item.record.status === 'resolved');
    const descriptions = (items: typeof symptoms) =>
      items
        .slice(0, 3)
        .map(item => `‘${item.record.description}’`)
        .join(', ');
    result.push(
      claim(
        [
          active.length
            ? `오늘 기록에는 ${descriptions(active)} 증상이 지속 중으로 남아 있어요.`
            : '',
          resolved.length
            ? `${descriptions(resolved)} 증상은 해소된 것으로 기록되어 있어요.`
            : '',
          '기록 이후의 현재 상태나 원인은 이 보고서만으로 확인할 수 없어요.',
        ]
          .filter(Boolean)
          .join(' '),
        symptoms.map(item => item.index),
      ),
    );
  }
  const groups = new Map<
    string,
    {
      index: number;
      amount: number;
      at: string;
      unit: string;
      concept: string;
    }[]
  >();
  for (const [index, item] of values.entries()) {
    if (
      item.kind !== 'health_observation' ||
      item.record.value.kind !== 'quantity' ||
      item.record.observationKind !== 'measurement'
    )
      continue;
    const { record } = item;
    if (record.value.kind !== 'quantity') continue;
    // Compare only the same metric, unit and source. Do not sum overlapping
    // wearables, cumulative samples, or compare incompatible measurement methods.
    const key = JSON.stringify([
      record.concept,
      record.value.unit,
      record.provenance.origin,
      record.provenance.source?.system,
      record.provenance.source?.sourceName,
    ]);
    const group = groups.get(key) ?? [];
    group.push({
      index,
      amount: record.value.amount,
      unit:
        record.concept === 'step_count'
          ? '걸음'
          : record.value.unit === 'count/min'
            ? '회/분'
            : record.value.unit,
      at: record.effectiveAt,
      concept: visibleValue(record.concept, 'concept') ?? record.concept,
    });
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort(
    (a, b) =>
      Number(b.some(x => selected.includes(x.index))) -
      Number(a.some(x => selected.includes(x.index))),
  );
  for (const group of ranked.slice(0, 3)) {
    group.sort((a, b) => compareTimestamps(a.at, b.at));
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const indexes = group.map(item => item.index);
    if (indexes.some(index => blocked.has(index))) {
      result.push(
        claim(
          `${first.concept} 기록에 같은 시각의 서로 다른 값 또는 단위가 있어 오늘의 변화 방향을 판단하지 않았어요. 원본 기록을 함께 확인해 주세요.`,
          [
            ...new Set([
              ...indexes,
              ...[...blocked].filter(index => {
                const item = values[index];
                return (
                  item?.kind === 'health_observation' &&
                  visibleValue(item.record.concept, 'concept') === first.concept
                );
              }),
            ]),
          ],
        ),
      );
    } else if (
      first.at !== last.at &&
      compareTimestamps(first.at, last.at) !== 0
    ) {
      const valuesText =
        first.amount === last.amount
          ? `첫 기록과 마지막 기록이 모두 ${first.amount} ${first.unit}였어요. 중간 값까지 일정했다는 뜻은 아니에요.`
          : `첫 기록 ${first.amount} ${first.unit}에서 마지막 기록 ${last.amount} ${last.unit}로 ${last.amount > first.amount ? '높아졌어요' : '낮아졌어요'}.`;
      result.push(
        claim(
          `오늘 ${first.concept}은 ${valuesText} 측정 조건과 평소 기준이 없어 건강이 좋아지거나 나빠졌다는 의미로 해석하지 않았어요.`,
          [first.index, last.index],
        ),
      );
    } else {
      result.push(
        claim(
          `오늘 ${first.concept}은 ${first.amount} ${first.unit}로 기록되어 있어요. 비교할 다른 시점의 값이 없어 하루 동안의 변화는 알 수 없어요.`,
          [first.index],
        ),
      );
    }
  }
  if (!result.length)
    result.push(
      claim(
        '오늘 남긴 기록만으로는 몸 상태나 하루 동안의 변화를 판단하기 어려워요. 아래 기록을 참고하되, 기록이 없는 것을 증상이나 문제가 없다는 뜻으로 보지 않았어요.',
        selected.length ? selected : [0],
      ),
    );
  return result;
}
