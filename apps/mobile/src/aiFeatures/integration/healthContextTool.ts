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
import { healthContextToolDefinition } from './healthContextToolDefinition';

/** A request can prove its exact canonical scope before asking for local access. */
export function parseHealthContextToolInput(
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
      (typeof v.detail !== 'string' ||
        !['summary', 'weekly', 'daily'].includes(v.detail))) ||
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
    detail: v.detail ?? 'summary',
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
    ...healthContextToolDefinition(feature),
    parseInput: value => parseHealthContextToolInput(value, feature === 'rag'),
    async search(request) {
      const input = parseHealthContextToolInput(
        request.input,
        feature === 'rag',
      );
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
