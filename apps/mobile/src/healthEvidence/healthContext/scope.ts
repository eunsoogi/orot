import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import { healthContextDays } from './window';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

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
    healthContextDays(w as unknown as HealthContextWindow);
    if (w.doseHistory !== undefined) {
      const d = w.doseHistory as Record<string, unknown>;
      if (
        !d ||
        typeof d !== 'object' ||
        Array.isArray(d) ||
        Object.keys(d).some(
          key => !['medicationName', 'page', 'pageSize'].includes(key),
        ) ||
        !Number.isInteger(d.page) ||
        Number(d.page) < 0 ||
        Number(d.page) > 1000 ||
        !Number.isInteger(d.pageSize) ||
        Number(d.pageSize) < 1 ||
        Number(d.pageSize) > 20 ||
        (d.medicationName !== undefined &&
          (typeof d.medicationName !== 'string' ||
            !d.medicationName.trim() ||
            d.medicationName.length > 200))
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

/** Unrelated out-of-period deletions must not change a historical data revision. */
export function healthContextRevision(
  scope: HealthContextScope,
  report: HealthContextReport,
): string {
  return fingerprint({
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
}
