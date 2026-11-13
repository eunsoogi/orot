import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createResearchInputTracker } from './researchInputTracker';
import type { conversationExternalEvidence } from './conversationExternalEvidence';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import { toolsFor } from './featureServiceExecution';

/** A failed local retrieval remains distinguishable from an empty source set. */
export function createConversationToolBundle(input: {
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly observer?: RagConversationObserver;
  readonly researchInputs: ReturnType<typeof createResearchInputTracker>;
  readonly external: ReturnType<typeof conversationExternalEvidence>;
  readonly publicSearchSucceeded: boolean;
}) {
  let failed = false;
  const generated = conversationGeneratedTools(
    input.data,
    input.registry,
    input.observer,
  );
  const tools = [
    ...observeLocalSearchFailures(
      input.researchInputs.wrap([
        ...toolsFor(undefined, input.data, input.registry, 6, true, 'rag'),
        ...generated.tools,
      ]),
      () => {
        failed = true;
      },
    ),
    ...(input.publicSearchSucceeded || !input.external.publicWebTool
      ? input.external.tools
      : []),
  ];
  return { tools, generated, localRetrievalFailed: () => failed };
}
