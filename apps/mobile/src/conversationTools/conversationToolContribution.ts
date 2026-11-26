import type { EvidenceSearchTool } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { DefaultPublicSearchResult } from '../aiFeatures/integration/defaultPublicSearch';

/** Tool-owned metadata. Supplying a contribution is not permission to invoke it. */
export type ConversationEvidenceTool = EvidenceSearchTool & {
  readonly explicitRoute?: 'medical-literature';
  readonly initialLookup?: {
    input(request: string): JsonObject;
    run(input: {
      tool: EvidenceSearchTool;
      operationRunId: string;
      request: string;
      signal: AbortSignal;
    }): Promise<DefaultPublicSearchResult>;
  };
};

/** Default lookup is uniquely offered; an ambiguous catalog cannot dispatch eagerly. */
export function initialConversationLookup(
  tools: readonly ConversationEvidenceTool[],
) {
  const first = tools.filter(tool => tool.initialLookup);
  const capabilities = first[0]?.initialLookup;
  return first.length === 1 && capabilities
    ? { tool: first[0]!, ...capabilities }
    : undefined;
}
