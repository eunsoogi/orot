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
    Object.keys(w).length !== 3 ||
    !['fromInclusive', 'toExclusive', 'timeZone'].every(
      key => typeof w[key] === 'string',
    )
  )
    return undefined;
  try {
    healthContextDays(w as unknown as HealthContextWindow);
    return {
      kind: 'health_context_period',
      version: 1,
      topic: v.topic as HealthContextTopic,
      window: {
        fromInclusive: w.fromInclusive as string,
        toExclusive: w.toExclusive as string,
        timeZone: w.timeZone as string,
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
      sleep: report.sleep,
      symptoms: report.symptoms,
      limitations: report.limitations,
    },
  });
}
