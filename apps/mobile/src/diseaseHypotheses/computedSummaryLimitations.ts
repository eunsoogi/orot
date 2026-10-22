import type { ComputedFact } from './computedStatisticChoice';

const limits: Readonly<Record<string, string>> = {
  quantity_sensor_series_limit_reached:
    '집계할 수 있는 측정 출처 수를 넘어 일부 출처가 제외됐어요. 이 요약은 전체 측정 기록을 포함하지 않아요.',
  medication_catalog_limit_reached:
    '집계할 수 있는 복용약 목록 수를 넘어 일부 약이 제외됐어요. 이 요약은 전체 복용약 목록을 포함하지 않아요.',
  unsupported_sleep_categories_excluded_from_duration:
    '해석할 수 없는 수면 분류는 시간 계산에서 제외됐어요. 수면 집계가 일부 기록을 포함하지 않을 수 있어요.',
  unrecorded_days_are_unknown_not_zero_or_missed_doses:
    '기록하지 않은 날짜의 값은 알 수 없으며, 0으로 해석하지 않아요.',
  medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion:
    '약의 등록이나 현재 복용 확인은 개별 복약 완료 기록과 구분해요.',
  sensor_step_sample_sums_may_overlap_do_not_add_series_or_infer_complete_daily_totals:
    '센서별 걸음 샘플은 중복될 수 있어 출처끼리 더하거나 전체 일일 걸음수로 해석할 수 없어요.',
};

/** Known app-authored aggregation limits survive in final uncertainty and preview.
 * Unknown codes become a visible scope warning, never raw internal identifiers.
 * The projection's cross-topic medication rule belongs only to medication summaries. */
export function computedSummaryLimitations(source: ComputedFact): string[] {
  if (!Array.isArray(source.limitations)) return [];
  return [
    ...new Set(
      source.limitations.flatMap(code => {
        if (typeof code !== 'string') return [];
        if (
          code === 'unrecorded_days_are_unknown_not_zero_or_missed_doses' &&
          source.topic === 'medications'
        )
          return [
            '개별 복약 기록이 없는 날짜의 완료 여부는 알 수 없으며, 미복용으로 해석하지 않아요.',
          ];
        if (
          code ===
            'medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion' &&
          source.topic !== 'medications'
        )
          return [];
        return [
          Object.hasOwn(limits, code)
            ? limits[code]!
            : '이 집계에는 추가적인 범위 제한이 있어요. 근거에서 원본의 집계 범위를 확인해 주세요.',
        ];
      }),
    ),
  ];
}
