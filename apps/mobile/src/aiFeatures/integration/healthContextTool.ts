import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  HEALTH_CONTEXT_TOPICS,
  type HealthContextTopic,
} from '../../healthEvidence/healthContext/types';
import type { HealthContextDetail } from '../../healthEvidence/healthContext/projection';
import { recentHealthContextWindow } from '../../healthEvidence/healthContext/window';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { providerDiagnostic } from '../../providers/diagnostics';
import { registerHealthContextEvidence } from './healthContextEvidence';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from './evidenceUtils';

function parseInput(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(key => !['days', 'topics', 'detail'].includes(key)) ||
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
  return {
    days: (v.days as number) ?? 30,
    topics: (v.topics as string[]) ?? [...HEALTH_CONTEXT_TOPICS],
    detail: (v.detail as string) ?? 'summary',
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
      'Read longitudinal health context from the entire last 7, 30 (default), or 90 local calendar days. Prefer this for broad summaries and trends: current medications and dose-history coverage, daily blood pressure/heart-rate/body-mass statistics, separate activity sensor series, unioned sleep durations, and symptom coverage. Choose topics and summary (compact), weekly, or daily detail. Missing days are unknown, not zero. Step sensor sums are not merged Health daily totals; never add overlapping series. Use local-personal-records for original record drilldown. No transcript or photo is required.',
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
      },
      additionalProperties: false,
    },
    parseInput,
    async search(request) {
      const input = parseInput(request.input);
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
      const window = recentHealthContextWindow(input.days as 7 | 30 | 90);
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
