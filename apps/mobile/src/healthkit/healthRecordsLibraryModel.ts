import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';

export type HealthRecordCategory =
  | 'blood_pressure'
  | 'heart_rate'
  | 'steps'
  | 'body_mass'
  | 'sleep'
  | 'medications'
  | 'other';

export type HealthObservationCategory = Exclude<
  HealthRecordCategory,
  'medications'
>;

export type HealthRecordPeriod =
  'month' | 'three_months' | 'six_months' | 'year' | 'all';

const categoryOrder: readonly HealthRecordCategory[] = [
  'blood_pressure',
  'heart_rate',
  'steps',
  'body_mass',
  'sleep',
  'medications',
  'other',
];

export interface HealthRecordsDetailSelection {
  readonly category: HealthRecordCategory;
  readonly period: HealthRecordPeriod;
}

/** Keeps every mockup category reachable, including types with no imported rows. */
export function healthRecordCategories(): readonly HealthRecordCategory[] {
  return categoryOrder;
}

/** Filters result data; horizontal chips keep every type reachable independently. */
export function filterHealthRecordCategories(
  categories: readonly HealthRecordCategory[],
  selected: HealthRecordCategory | 'all',
): HealthRecordCategory[] {
  const visible = categoryOrder.filter(category =>
    categories.includes(category),
  );
  if (selected === 'all') return visible;
  return visible.filter(category => category === selected);
}

export interface BloodPressureReading {
  readonly id: string;
  readonly effectiveAt: string;
  readonly systolic: HealthObservation | null;
  readonly diastolic: HealthObservation | null;
}

export function healthRecordCategoryTitle(
  category: HealthRecordCategory,
): string {
  switch (category) {
    case 'blood_pressure':
      return t('healthRecords.category.blood_pressure');
    case 'heart_rate':
      return t('healthRecords.category.heart_rate');
    case 'steps':
      return t('healthRecords.category.steps');
    case 'body_mass':
      return t('healthRecords.category.body_mass');
    case 'sleep':
      return t('healthRecords.category.sleep');
    case 'medications':
      return t('healthRecords.category.medications');
    case 'other':
      return t('healthRecords.category.other');
  }
}

export function healthRecordPeriodTitle(period: HealthRecordPeriod): string {
  switch (period) {
    case 'month':
      return t('healthRecords.period.month');
    case 'three_months':
      return t('healthRecords.period.three_months');
    case 'six_months':
      return t('healthRecords.period.six_months');
    case 'year':
      return t('healthRecords.period.year');
    case 'all':
      return t('healthRecords.period.all');
  }
}

/** Keeps chart and detail classification anchored to the imported observation concept. */
export function classifyHealthObservation(
  observation: HealthObservation,
): HealthObservationCategory {
  if (
    observation.concept === 'blood pressure systolic' ||
    observation.concept === 'blood pressure diastolic'
  ) {
    return 'blood_pressure';
  }
  switch (observation.concept) {
    case 'heart_rate':
      return 'heart_rate';
    case 'step_count':
      return 'steps';
    case 'body_mass':
      return 'body_mass';
    case 'HKCategoryTypeIdentifierSleepAnalysis':
      return 'sleep';
    default:
      return 'other';
  }
}

/** Pairs only components that share the same imported HealthKit correlation ID. */
export function groupBloodPressureObservations(
  observations: readonly HealthObservation[],
): BloodPressureReading[] {
  const readings = new Map<string, BloodPressureReading>();
  for (const observation of observations) {
    if (classifyHealthObservation(observation) !== 'blood_pressure') continue;
    const component =
      observation.concept === 'blood pressure systolic'
        ? 'systolic'
        : 'diastolic';
    const correlationId =
      observation.provenance.sourceRecordIds.length > 1
        ? observation.provenance.sourceRecordIds[0]
        : undefined;
    let id = correlationId ?? 'unpaired:' + observation.id;
    let current = readings.get(id);
    if (current?.[component]) {
      id += ':' + observation.id;
      current = undefined;
    }
    const systolic =
      component === 'systolic' ? observation : (current?.systolic ?? null);
    const diastolic =
      component === 'diastolic' ? observation : (current?.diastolic ?? null);
    const effectiveAt =
      systolic && diastolic
        ? systolic.effectiveAt > diastolic.effectiveAt
          ? systolic.effectiveAt
          : diastolic.effectiveAt
        : observation.effectiveAt;
    readings.set(id, { id, effectiveAt, systolic, diastolic });
  }
  return [...readings.values()].sort((left, right) =>
    right.effectiveAt.localeCompare(left.effectiveAt),
  );
}

/** Uses calendar-month boundaries and excludes future-dated imported observations. */
export function filterObservationsByPeriod(
  observations: readonly HealthObservation[],
  period: HealthRecordPeriod,
  now: string,
): HealthObservation[] {
  const end = new Date(now).getTime();
  const start =
    healthRecordPeriodStart(period, now)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return sortObservations(
    observations.filter(item => {
      const effectiveAt = new Date(item.effectiveAt).getTime();
      return effectiveAt >= start && effectiveAt <= end;
    }),
  );
}

/** Exposes the paging cutoff so detail views can stop after all in-range rows are read. */
export function healthRecordPeriodStart(
  period: HealthRecordPeriod,
  now: string,
): Date | null {
  if (period === 'all') return null;
  const months =
    period === 'month'
      ? 1
      : period === 'three_months'
        ? 3
        : period === 'six_months'
          ? 6
          : 12;
  return subtractCalendarMonths(new Date(now), months);
}

function sortObservations(
  observations: readonly HealthObservation[],
): HealthObservation[] {
  return [...observations].sort((left, right) => {
    const byTime = right.effectiveAt.localeCompare(left.effectiveAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

function subtractCalendarMonths(date: Date, months: number): Date {
  const target = new Date(date);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
