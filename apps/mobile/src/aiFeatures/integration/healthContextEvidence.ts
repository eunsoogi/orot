import type { EvidenceReference } from '@orot/agent-runtime';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import {
  healthContextRevision,
  type HealthContextScope,
} from '../../healthEvidence/healthContext/scope';
import {
  projectHealthContext,
  type HealthContextDetail,
} from '../../healthEvidence/healthContext/projection';
import {
  LocalEvidenceReferenceRegistry,
  type EvidenceSourceReadResult,
} from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

export function healthContextContent(
  scope: HealthContextScope,
  report: HealthContextReport,
  detail: HealthContextDetail = 'summary',
) {
  const projected = projectHealthContext(report, detail);
  const { period, calendarDays, partialDates, limitations } = projected;
  const facts =
    scope.topic === 'measurements' || scope.topic === 'activity'
      ? { quantities: projected.quantities }
      : { [scope.topic]: projected[scope.topic] };
  return (
    'health_context: ' +
    JSON.stringify({
      topic: scope.topic,
      period,
      calendarDays,
      partialDates,
      ...facts,
      // App-authored meanings accompany the tool result; no extra samples or availability claims are inferred.
      statisticSemantics:
        scope.topic === 'measurements' || scope.topic === 'activity'
          ? {
              sampleCount:
                'Number of observation samples, never a measured amount.',
              latest:
                'One latest measured amount with its occurrence time, never a sample count or period total.',
              recordedDays:
                'Calendar days with observations, not the number of samples.',
              sensorSeries:
                'Separate measurement sources; do not add overlapping sources into a daily total.',
            }
          : scope.topic === 'sleep'
            ? {
                meanRecordedDailyMinutes:
                  'Mean of calendar-day unions of asleep intervals over recorded dates, not a complete-night total.',
                stageMinutes:
                  'Stage totals over the whole period, not daily means.',
                completeNightCoverage:
                  'Calendar-day aggregation establishes neither presence nor absence of complete-night records.',
              }
            : undefined,
      limitations,
    })
  );
}

/** Register a typed computed source: the original period is re-read, never reconstructed from model prose. */
export function registerHealthContextEvidence(input: {
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly read: HealthContextReader;
  readonly scope: HealthContextScope;
  readonly report: HealthContextReport;
  readonly detail?: HealthContextDetail;
  readonly original?: EvidenceReference;
  readonly expectedRevision?: string;
}) {
  const { scope, report } = input;
  const revision =
    input.expectedRevision ?? healthContextRevision(scope, report);
  const id = `health-context-${fingerprint(scope)}`;
  const current = async (signal: AbortSignal) =>
    input.read(scope.window, [scope.topic], signal);
  const matches = (value: HealthContextReport) =>
    healthContextRevision(scope, value) === revision;
  const readSource = async (
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> => {
    if (signal.aborted) return { status: 'unavailable' };
    const value = await current(signal);
    return matches(value)
      ? {
          status: 'available',
          document: {
            sourceKind: 'health_context_period',
            scope,
            report: value,
          },
        }
      : { status: 'changed' };
  };
  const key = {};
  return input.registry.add({
    reference: input.original ?? {
      sourceKind: 'personal_record',
      sourceId: id,
      sourceRevision: revision,
      evidenceId: id,
      evidenceRevision: revision,
      locator: { ...scope, window: { ...scope.window } },
      // An aggregate spans a period; import time and a fictitious single event time would be misleading.
      effectiveTime: null,
      reviewState: 'unknown',
    },
    content: healthContextContent(scope, report, input.detail),
    readSource,
    validate: async (signal, context) => {
      const value = await context.once(key, () => current(signal));
      return (
        !signal.aborted &&
        value.deletionGeneration === report.deletionGeneration &&
        matches(value)
      );
    },
  });
}
