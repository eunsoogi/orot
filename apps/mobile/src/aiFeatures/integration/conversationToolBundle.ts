import { europePmcConversationTool } from './explicitConversationLiteratureRoute';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createResearchInputTracker } from './researchInputTracker';
import type { conversationExternalEvidence } from './conversationExternalEvidence';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import { toolsFor } from './featureServiceExecution';

/** This tool asks for an exact user reply without opening storage or returning metadata. */
const recordingClarificationTool: EvidenceSearchTool = {
  id: 'local-saved-recording-transcript',
  description:
    'When the user explicitly asks to read a saved recording transcript, use this tool to ask which recording they mean. Do not use for unrelated health records.',
  sourceKind: 'personal_record',
  execution: 'local_read_only',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  parseInput: value =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
      ? {}
      : undefined,
  search: async () => ({ status: 'recording_selector_required' }),
};

/** A failed local retrieval remains distinguishable from an empty source set. */
export function createConversationToolBundle(input: {
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly observer?: RagConversationObserver;
  readonly researchInputs: ReturnType<typeof createResearchInputTracker>;
  readonly external: ReturnType<typeof conversationExternalEvidence>;
  readonly publicSearchSucceeded: boolean;
  readonly literatureOnly?: boolean;
  readonly artifactPaging?: unknown;
  readonly researchPaging?: { snapshot: unknown; operationRunId: string };
}) {
  let failed = false;
  const generated = conversationGeneratedTools(
    input.data,
    input.registry,
    input.observer,
    input.researchPaging,
    input.artifactPaging,
  );
  const tools = [
    ...observeLocalSearchFailures(
      input.researchInputs.wrap([
        ...toolsFor(undefined, input.data, input.registry, 6, true, 'rag'),
        ...generated.tools,
        ...(!input.literatureOnly &&
        input.observer?.inputOrigin === 'composer' &&
        input.observer.recordingClarification
          ? [recordingClarificationTool]
          : []),
      ]),
      () => {
        failed = true;
      },
    ),
    ...(input.literatureOnly
      ? input.external.tools.filter(
          tool => tool.id === europePmcConversationTool,
        )
      : input.publicSearchSucceeded || !input.external.publicWebTool
        ? input.external.tools
        : []),
  ];
  return { tools, generated, localRetrievalFailed: () => failed };
}
