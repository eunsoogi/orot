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
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from './evidenceUtils';

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
    (v.days !== undefined && ![7, 30, 90].includes(Number(v.days))) ||
    (v.days !== undefined && typeof v.days !== 'number') ||
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
  if (
    v.window !== undefined &&
    (!allowDoseHistory ||
      v.days !== undefined ||
      !scope?.window.doseHistory ||
      (v.topics !== undefined &&
        (v.topics as unknown[]).some(topic => topic !== 'medications')))
  )
    return undefined;
  return {
    ...(v.window ? {} : { days: (v.days as number) ?? 30 }),
    topics:
      (v.topics as string[]) ??
      (v.window ? ['medications'] : [...HEALTH_CONTEXT_TOPICS]),
    detail: (v.detail as string) ?? 'summary',
    ...(v.window ? { window: v.window as JsonObject } : {}),
  };
}

/** Model-selected period aggregation is separate from ranked raw-record drilldown. Nothing is preloaded before a tool call. */
export function createHealthContextTool(
  read: HealthContextReader,
  registry: LocalEvidenceReferenceRegistry,
  feature: 'disease' | 'rag' | 'visit' = 'disease',
): EvidenceSearchTool {
  return {
    id: 'local-health-context',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description:
      'Read longitudinal health context from the last 7, 30 (default), or 90 local calendar days. For broad summaries choose topics and summary, weekly, or daily detail. Step sensor sums are separate, not merged totals.' +
      (feature === 'rag'
        ? ' For detailed medication history choose window with explicit ISO instants, IANA timeZone, and doseHistory containing an optional exact medicationName, zero-based page (0-1000) and pageSize (1-20). The range covers at most 90 local days and is [fromInclusive, toExclusive); convert local calendar boundaries using the requested time zone. Follow hasMore with the next page up to page 1000; narrow the period beyond that. Data changes can shift pages. Registration and scheduled times are not intake; an absent event is unknown.'
        : ''),
    inputSchema: {
      type: 'object',
      properties: {
        // Apple native tools support string enums only. The closed numeric choices are enforced by parseInput.
        days: {
          type: 'integer',
          description: 'Choose 7, 30, or 90 local calendar days; default 30.',
        },
        topics: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: { type: 'string', enum: [...HEALTH_CONTEXT_TOPICS] },
        },
        detail: { type: 'string', enum: ['summary', 'weekly', 'daily'] },
        ...(feature === 'rag'
          ? {
              window: {
                type: 'object',
                description:
                  'Medication period: explicit ISO instant fromInclusive and toExclusive, IANA timeZone, and doseHistory { medicationName?: exact name, page: zero-based integer, pageSize: 1-20 }. Omit days.',
                properties: {
                  fromInclusive: { type: 'string' },
                  toExclusive: { type: 'string' },
                  timeZone: { type: 'string' },
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
                },
                required: [
                  'fromInclusive',
                  'toExclusive',
                  'timeZone',
                  'doseHistory',
                ],
                additionalProperties: false,
              },
            }
          : {}),
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
        : recentHealthContextWindow(input.days as 7 | 30 | 90);
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
          report,
          scope: { kind: 'health_context_period', version: 1, topic, window },
          detail: input.detail as HealthContextDetail,
        });
        items.push(item);
        if (
          jsonByteLength(batch()) >
          Math.min(request.maxPayloadBytes, MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES)
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
