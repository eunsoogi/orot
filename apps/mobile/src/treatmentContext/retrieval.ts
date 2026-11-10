import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import {
  parsePublicWebQuery,
  publicMedicalTopicLabels,
  publicWebQuerySchema,
} from '../agent/execution/publicWebQuery';

const treatmentPublicEvidenceBrand: unique symbol = Symbol(
  'treatment-public-evidence',
);
export type TreatmentPublicEvidenceTool = EvidenceSearchTool & {
  readonly [treatmentPublicEvidenceBrand]: true;
};

/** Only app-owned topic labels cross the public search boundary; the wrapped tool owns consent. */
export function createTreatmentPublicEvidenceTool(
  options: Parameters<typeof createEuropePmcEvidenceSearchTool>[0],
): TreatmentPublicEvidenceTool {
  const tool = createEuropePmcEvidenceSearchTool(options);
  return {
    ...tool,
    [treatmentPublicEvidenceBrand]: true,
    inputSchema: publicWebQuerySchema,
    parseInput(value) {
      return publicMedicalTopicLabels(value)
        ? (value as { readonly topics: string[] })
        : undefined;
    },
    async search(request) {
      const input = parsePublicWebQuery(request.input);
      if (!input)
        throw new Error(
          'Treatment literature requires controlled public topics.',
        );
      const result = await tool.search({ ...request, input });
      if ('status' in result) return result;
      return {
        ...result,
        items: result.items.map(item => {
          const locator = item.locator;
          if (!locator || typeof locator !== 'object' || Array.isArray(locator))
            throw new Error('Publication provenance is unavailable.');
          // The adapter observes abstract retrieval, not full-text availability or population applicability.
          const availability = item.content.startsWith(
            'Access: title, bibliography and abstract\n',
          )
            ? 'abstract'
            : 'metadata_only';
          return {
            ...item,
            locator: {
              ...locator,
              sourceType: 'publication',
              population: null,
              availability,
              limitations: [
                'Full text not retrieved',
                'Publication and retraction status not checked',
                'Population applicability not established',
              ],
            },
          };
        }),
      };
    },
  };
}
