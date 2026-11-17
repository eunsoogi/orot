import type { ResolveHealthContextWindow } from '../../healthEvidence/healthContext/availableWindow';
import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  HEALTH_CONTEXT_TOPICS,
  type HealthContextTopic,
} from '../../healthEvidence/healthContext/types';
import type { HealthContextDetail } from '../../healthEvidence/healthContext/projection';
import { recentHealthContextWindow } from '../../healthEvidence/healthContext/window';
import { parseHealthContextScope } from '../../healthEvidence/healthContext/scope';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { providerDiagnostic } from '../../providers/diagnostics';
import { registerHealthContextEvidence } from './healthContextEvidence';
import { refreshHealthContextRead } from './refreshHealthContextRead';
import { jsonByteLength } from './evidenceUtils';

function parseInput(
  value: unknown,
  allowDoseHistory: boolean,
): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      key => !['days', 'topics', 'detail', 'window'].includes(key),
    ) ||
    (v.days !== undefined &&
      (typeof v.days !== 'number' ||
        !Number.isSafeInteger(v.days) ||
        v.days < 1)) ||
    (v.detail !== undefined &&
      !['summary', 'weekly', 'daily'].includes(String(v.detail))) ||
    (v.topics !== undefined &&
      (!Array.isArray(v.topics) ||
        !v.topics.length ||
        v.topics.length > 5 ||
        v.topics.some(
          topic => !HEALTH_CONTEXT_TOPICS.includes(topic as HealthContextTopic),
        )))
  )
    return undefined;
  const scope =
    v.window === undefined
      ? undefined
      : parseHealthContextScope({
          kind: 'health_context_period',
          version: 1,
          topic: 'medications',
          window: v.window,
        });
  // Explicit clinical periods are available to every feature; dose history remains RAG-only.
  if (
    v.window !== undefined &&
    (v.days !== undefined ||
      !scope ||
      (!allowDoseHistory && scope.window.doseHistory) ||
      (scope.window.doseHistory &&
        v.topics !== undefined &&
        (v.topics as unknown[]).some(topic => topic !== 'medications')))
  )
    return undefined;
  return {
    ...(v.days === undefined ? {} : { days: v.days as number }),
    topics:
      (v.topics as string[]) ??
      (scope?.window.doseHistory
        ? ['medications']
        : [...HEALTH_CONTEXT_TOPICS]),
    detail: (v.detail as string) ?? 'summary',
    ...(v.window ? { window: v.window as JsonObject } : {}),
  };
}

/** Model-selected period aggregation is separate from ranked raw-record drilldown. Nothing is preloaded before a tool call. */
export function createHealthContextTool(
  read: HealthContextReader,
  registry: LocalEvidenceReferenceRegistry,
  feature: 'disease' | 'rag' | 'visit' = 'disease',
  refreshUnexposed = false,
  resolveWindow?: ResolveHealthContextWindow,
): EvidenceSearchTool {
  return {
    id: 'local-health-context',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description:
      'Read longitudinal health context across all available imported history by default. Specify positive calendar days or an explicit window only when the requested clinical period is narrower. For broad summaries choose topics and summary, weekly, or daily detail. Step sensor sums are separate, not merged totals. Measurements include heart-rate sample ranges grouped by time overlap with already imported workout intervals, not proof of exercise, rest or causation. No new HealthKit reads are performed.' +
      ' Explicit windows are [fromInclusive, toExclusive) ISO instants in an IANA time zone. Convert calendar boundaries using the requested zone.' +
      (feature === 'rag'
        ? ' Medication doseHistory supports an exact medicationName and nonnegative page with pageSize 1-20. Follow hasMore. Registration and scheduled times are not intake; absent events are unknown.'
        : ''),
    inputSchema: {
      type: 'object',
      properties: {
        // The parser validates an explicit positive day count; omission never inserts a time cutoff.
        days: {
          type: 'integer',
          description:
            'Positive local calendar days only for a requested relative period; omit for all available history.',
        },
        topics: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', enum: [...HEALTH_CONTEXT_TOPICS] },
        },
        detail: { type: 'string', enum: ['summary', 'weekly', 'daily'] },
        ...{
          window: {
            type: 'object',
            description:
              'Period for selected topics: explicit ISO instant fromInclusive and toExclusive, IANA timeZone. Omit days. Optional doseHistory { medicationName?: exact name, page: zero-based integer, pageSize: 1-20 } is medications-only.',
            properties: {
              fromInclusive: { type: 'string' },
              toExclusive: { type: 'string' },
              timeZone: { type: 'string' },
              ...(feature === 'rag'
                ? {
                    doseHistory: {
                      type: 'object',
                      properties: {
                        medicationName: { type: 'string' },
                        page: { type: 'integer' },
                        pageSize: { type: 'integer' },
                      },
                      required: ['page', 'pageSize'],
                      additionalProperties: false,
                    },
                  }
                : {}),
            },
            required: ['fromInclusive', 'toExclusive', 'timeZone'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    parseInput: value => parseInput(value, feature === 'rag'),
    async search(request) {
      const input = parseInput(request.input, feature === 'rag');
      if (!input || request.signal.aborted)
        throw new Error('Invalid or cancelled health context request.');
      providerDiagnostic(feature, 'data', 'context_started');
      const items: EvidenceBatch['items'][number][] = [];
      const gaps: string[] = [];
      const batch = (): EvidenceBatch => ({
        items,
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: items.map(item => item.sourceId),
            gaps,
            truncated: gaps.length > 0,
            resultLimit: request.resultLimit,
            returnedCount: items.length,
          },
        ],
        conflicts: [],
      });
      // A whole-period aggregate cannot safely satisfy a source-only or narrower instant authorization.
      // Explicitly defer to the scoped raw-record tool instead of silently widening access.
      if (
        !request.allowedScope.sourceKinds.includes('personal_record') ||
        request.allowedScope.sourceIds ||
        request.allowedScope.timeRange
      ) {
        gaps.push(
          'period_context_requires_unrestricted_personal_record_scope_use_scoped_raw_search',
        );
        return batch();
      }
      const window = input.window
        ? parseHealthContextScope({
            kind: 'health_context_period',
            version: 1,
            topic: 'medications',
            window: input.window,
          })!.window
        : input.days !== undefined
          ? recentHealthContextWindow(input.days as number)
          : resolveWindow
            ? await resolveWindow(request.signal)
            : undefined;
      if (window === undefined)
        throw new Error(
          'An explicit health context period is required when availability cannot be resolved.',
        );
      if (window === null) return batch();
      for (const topic of [...new Set(input.topics as HealthContextTopic[])]) {
        if (items.length >= request.resultLimit) {
          gaps.push('topic_result_limit_reached');
          break;
        }
        const report = await read(
          window,
          [topic],
          request.signal,
          (phase, status) =>
            providerDiagnostic(feature, 'data', `context_${phase}_${status}`),
        );
        const item = registerHealthContextEvidence({
          registry,
          read,
          report:
            feature === 'rag' && refreshUnexposed
              ? await refreshHealthContextRead({
                  initial: report,
                  read,
                  signal: request.signal,
                  scope: {
                    kind: 'health_context_period',
                    version: 1,
                    topic,
                    window,
                  },
                })
              : report,
          scope: { kind: 'health_context_period', version: 1, topic, window },
          detail: input.detail as HealthContextDetail,
        });
        items.push(item);
        // Legacy bounded callers keep their envelope allowance; interactive work
        // retains complete topics and lets the selected provider report its capacity.
        if (
          request.executionLimits !== 'unbounded' &&
          jsonByteLength(batch()) > request.maxPayloadBytes
        ) {
          items.pop();
          gaps.push(
            'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
          );
        }
      }
      providerDiagnostic(feature, 'data', 'context_selected');
      return batch();
    },
  };
}
