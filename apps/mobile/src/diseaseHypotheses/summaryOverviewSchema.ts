import type { JsonObject } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { overviewSelectionSources } from './summaryOverviewSelections';

/** Source-relative row keys constrain generation; local binding remains authoritative. */
export function overviewSelectionSchema(
  input: TaskResponderInput | undefined,
  base: JsonObject,
): JsonObject | undefined {
  const sources = overviewSelectionSources(input);
  if (!sources) return;
  return {
    ...base,
    required: ['recordSelections'],
    properties: {
      ...(base.properties as JsonObject),
      recordSelections: {
        type: 'array',
        minItems: 1,
        maxItems: sources.length,
        items: {
          anyOf: sources.map(source => ({
            type: 'object',
            additionalProperties: false,
            required: ['sourceId', 'rows'],
            properties: {
              sourceId: { type: 'string', enum: [source.item.evidenceId] },
              rows: {
                type: 'array',
                minItems: 1,
                maxItems: source.rows.length,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: source.rows.map((_, index) => `r${index}`),
                },
              },
              limitationCodes: {
                type: 'array',
                maxItems: 1,
                uniqueItems: true,
                items: { type: 'string', enum: ['subset_only'] },
              },
            },
          })),
        },
      },
    },
  };
}
