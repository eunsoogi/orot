export type OverviewRow = {
  readonly label: string;
  readonly amount: number;
  readonly unit: string;
  readonly time?: string;
  readonly raw: import('@orot/model-runtime').JsonValue;
};

export const overviewConcepts: Readonly<
  Record<string, { label: string; sourceUnit: string; displayUnit: string }>
> = {
  step_count: { label: '걸음 수', sourceUnit: 'count', displayUnit: '걸음' },
  heart_rate: {
    label: '심박수',
    sourceUnit: 'count/min',
    displayUnit: 'count/min',
  },
  body_mass: { label: '체중', sourceUnit: 'kg', displayUnit: 'kg' },
  weight: { label: '체중', sourceUnit: 'kg', displayUnit: 'kg' },
  blood_pressure_systolic: {
    label: '수축기 혈압',
    sourceUnit: 'mmHg',
    displayUnit: 'mmHg',
  },
  blood_pressure_diastolic: {
    label: '이완기 혈압',
    sourceUnit: 'mmHg',
    displayUnit: 'mmHg',
  },
  'blood pressure systolic': {
    label: '수축기 혈압',
    sourceUnit: 'mmHg',
    displayUnit: 'mmHg',
  },
  'blood pressure diastolic': {
    label: '이완기 혈압',
    sourceUnit: 'mmHg',
    displayUnit: 'mmHg',
  },
};

/** Recognize a typed quantity without interpreting free-form source text. */
export function overviewRow(
  raw: unknown,
  effectiveTime?: string | null,
): OverviewRow | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.concept !== 'string' ||
    !row.value ||
    typeof row.value !== 'object' ||
    Array.isArray(row.value)
  )
    return;
  const value = row.value as Record<string, unknown>;
  const concept = row.concept.toLowerCase();
  if (!Object.hasOwn(overviewConcepts, concept)) return;
  const spec = overviewConcepts[concept];
  if (
    !spec ||
    value.kind !== 'quantity' ||
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.unit !== spec.sourceUnit
  )
    return;
  const time = row.effectiveAt ?? effectiveTime ?? undefined;
  if (
    time !== undefined &&
    (typeof time !== 'string' ||
      !Number.isFinite(Date.parse(time)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/u.test(time))
  )
    return;
  return {
    label: spec.label,
    amount: value.amount,
    unit: spec.displayUnit,
    ...(typeof time === 'string' ? { time } : {}),
    raw: raw as import('@orot/model-runtime').JsonValue,
  };
}

/** Same concept and instant with different amounts must be shown together or omitted together. */
export function conflictingOverviewRows(
  rows: readonly OverviewRow[],
): Set<number> {
  const result = new Set<number>();
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left]!;
      const b = rows[right]!;
      if (
        a.time &&
        b.time &&
        a.label === b.label &&
        Date.parse(a.time) === Date.parse(b.time) &&
        a.amount !== b.amount
      ) {
        result.add(left);
        result.add(right);
      }
    }
  }
  return result;
}
