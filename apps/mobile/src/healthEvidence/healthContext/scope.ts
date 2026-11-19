import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import { validateHealthContextCalendar } from './calendarValidation';
import {
  fingerprint,
  stableJson,
} from '../../aiFeatures/integration/evidenceUtils';
import { isImmutableReportSnapshot } from './committedReportScope';

export interface HealthContextScope {
  readonly kind: 'health_context_period';
  readonly version: 1;
  readonly topic: HealthContextTopic;
  readonly window: HealthContextWindow;
}

/** Persist a fixed local-calendar period and aggregation policy, never a relative moving date. */
export function parseHealthContextScope(
  value: unknown,
): HealthContextScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  if (
    v.kind !== 'health_context_period' ||
    v.version !== 1 ||
    !HEALTH_CONTEXT_TOPICS.includes(v.topic as HealthContextTopic) ||
    Object.keys(v).some(
      key => !['kind', 'version', 'topic', 'window'].includes(key),
    ) ||
    !v.window ||
    typeof v.window !== 'object' ||
    Array.isArray(v.window)
  )
    return undefined;
  const w = v.window as Record<string, unknown>;
  if (
    Object.keys(w).some(
      key =>
        ![
          'fromInclusive',
          'toExclusive',
          'timeZone',
          'dataAvailableThrough',
          'doseHistory',
        ].includes(key),
    ) ||
    !['fromInclusive', 'toExclusive', 'timeZone'].every(
      key => typeof w[key] === 'string',
    )
  )
    return undefined;
  if (
    w.dataAvailableThrough !== undefined &&
    typeof w.dataAvailableThrough !== 'string'
  )
    return undefined;
  try {
    validateHealthContextCalendar(w as unknown as HealthContextWindow);
    if (w.doseHistory !== undefined) {
      const d = w.doseHistory as Record<string, unknown>;
      if (
        !d ||
        typeof d !== 'object' ||
        Array.isArray(d) ||
        Object.keys(d).some(
          key => !['medicationName', 'page', 'pageSize'].includes(key),
        ) ||
        !Number.isSafeInteger(d.page) ||
        Number(d.page) < 0 ||
        !Number.isSafeInteger(Number(d.page) * Number(d.pageSize)) ||
        !Number.isInteger(d.pageSize) ||
        Number(d.pageSize) < 1 ||
        Number(d.pageSize) > 20 ||
        (d.medicationName !== undefined &&
          (typeof d.medicationName !== 'string' || !d.medicationName.trim()))
      )
        return undefined;
    }
    return {
      kind: 'health_context_period',
      version: 1,
      topic: v.topic as HealthContextTopic,
      window: {
        fromInclusive: w.fromInclusive as string,
        toExclusive: w.toExclusive as string,
        timeZone: w.timeZone as string,
        ...(w.dataAvailableThrough
          ? { dataAvailableThrough: w.dataAvailableThrough as string }
          : {}),
        ...(w.doseHistory
          ? { doseHistory: w.doseHistory as HealthContextWindow['doseHistory'] }
          : {}),
      },
    };
  } catch {
    return undefined;
  }
}

const revisions = new WeakMap<
  HealthContextReport,
  { scopeKey: string; revision: string }
>();

/** Exclude out-of-period deletions from the historical digest. Reuse one pure
 * digest per immutable report and exact scope; live generation checks belong to
 * the reader and its callers. */
export function healthContextRevision(
  scope: HealthContextScope,
  report: HealthContextReport,
): string {
  const scopeKey = isImmutableReportSnapshot(report)
    ? stableJson(scope)
    : undefined;
  const cached = scopeKey === undefined ? undefined : revisions.get(report);
  if (cached && cached.scopeKey === scopeKey) return cached.revision;
  const revision = fingerprint({
    scope,
    facts: {
      window: report.window,
      days: report.days,
      quantities: report.quantities,
      medications: report.medications,
      ...(report.doseHistory ? { doseHistory: report.doseHistory } : {}),
      sleep: report.sleep,
      symptoms: report.symptoms,
      limitations: report.limitations,
    },
  });
  if (scopeKey !== undefined) revisions.set(report, { scopeKey, revision });
  return revision;
}
