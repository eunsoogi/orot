import type { EvidenceSearchTool } from '@orot/agent-runtime';
import { HEALTH_CONTEXT_TOPICS } from '../healthEvidence/healthContext/types';

export type HealthContextToolDefinition = Pick<
  EvidenceSearchTool,
  'id' | 'sourceKind' | 'execution' | 'description' | 'inputSchema'
>;

/** Describe the same tool for Conversation and Live without opening a protected reader.
 * Each call returns a fresh schema so consumers cannot mutate shared state. */
export function healthContextToolDefinition(
  feature: 'disease' | 'rag' | 'visit',
): HealthContextToolDefinition {
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
  };
}
