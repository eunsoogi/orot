import { registerPeriodCaptureReaders } from './periodCaptureReaders';
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
import { isImmutableReportSnapshot } from '../../healthEvidence/healthContext/committedReportScope';

const summaryContent = new WeakMap<
  HealthContextReport,
  { topic: HealthContextScope['topic']; content: string }
>();

export function healthContextContent(
  scope: HealthContextScope,
  report: HealthContextReport,
  detail: HealthContextDetail = 'summary',
) {
  // Restoring aliases and reviewing saved prose use the same summary. Share
  // that pure projection only for an immutable report, never source validity.
  const reusable = detail === 'summary' && isImmutableReportSnapshot(report);
  const cached = reusable ? summaryContent.get(report) : undefined;
  if (cached?.topic === scope.topic) return cached.content;
  const projected = projectHealthContext(report, detail);
  const { period, calendarDays, partialDates, limitations } = projected;
  const facts =
    scope.topic === 'measurements' || scope.topic === 'activity'
      ? { quantities: projected.quantities }
      : scope.topic === 'medications' && projected.doseHistory
        ? {}
        : { [scope.topic]: projected[scope.topic] };
  const content =
    'health_context: ' +
    JSON.stringify({
      topic: scope.topic,
      period,
      calendarDays,
      partialDates,
      ...facts,
      ...(scope.topic === 'medications' && projected.doseHistory
        ? { doseHistory: projected.doseHistory }
        : {}),
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
          : scope.topic === 'medications'
            ? {
                scheduleStatus:
                  'registered and not_registered are known Health schedule states; not_available means this source supplies no schedule flag. No registered schedule does not negate recorded medication use or prove no prescription.',
                doseHistory:
                  'effectiveAt is the source event time, not necessarily intake: only taken or administered events or observed status taken establish recorded intake. scheduledAt is a scheduled time, not intake. Missing events are unknown. Pages are ordered by event time then internal identity; data changes between pages can shift results.',
                useEvidence:
                  'Acknowledge user_confirmed_current_use or recorded_doses_in_period as known evidence. The latter confirms observed doses only in this period, not future adherence. catalog_only and prescription_only describe this source, not the absence of use elsewhere. Missing dates remain unknown, not missed doses.',
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
    });
  if (reusable) summaryContent.set(report, { topic: scope.topic, content });
  return content;
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
  const key = {};
  const createReaders = (read: HealthContextReader) => {
    const current = async (signal: AbortSignal) =>
      read(scope.window, [scope.topic], signal);
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
    return {
      readSource,
      validate: async (
        signal: AbortSignal,
        context: import('./evidenceValidationContext').EvidenceValidationContext,
      ) => {
        const value = await context.once(key, () => current(signal));
        return (
          !signal.aborted &&
          value.deletionGeneration === report.deletionGeneration &&
          matches(value)
        );
      },
    };
  };
  const issuedRead = input.read;
  const originalRead: HealthContextReader = (...args) => input.read(...args);
  const readers = createReaders(originalRead);
  registerPeriodCaptureReaders(
    readers,
    input.registry,
    issuedRead,
    createReaders,
    () => input.read === issuedRead,
    originalRead,
  );
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
    ...readers,
  });
}
