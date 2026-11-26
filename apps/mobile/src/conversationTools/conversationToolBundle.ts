import { type ConversationEvidenceTool } from './conversationToolContribution';
import {
  conversationTypedReadContribution,
  type ConversationToolPreparationOwner,
} from './conversationTypedReadContribution';
import type { requireSelectedAi } from '../aiFeatures/integration/provider';
import type { ConversationToolContext } from './conversationToolContext';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import type { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import type { createResearchInputTracker } from '../aiFeatures/integration/researchInputTracker';
import { conversationGeneratedTools } from '../aiFeatures/integration/conversationGeneratedTools';
import { observeLocalSearchFailures } from '../aiFeatures/integration/observeLocalSearchFailures';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import {
  executionOptions,
  toolsFor,
} from '../aiFeatures/integration/featureServiceExecution';

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
  readonly observer?: ConversationToolContext;
  readonly researchInputs: ReturnType<typeof createResearchInputTracker>;
  readonly externalTools?: readonly ConversationEvidenceTool[];
  readonly publicSearchSucceeded: boolean;
  readonly literatureOnly?: boolean;
  readonly preparationOwner?: ConversationToolPreparationOwner;
  readonly selected?: ReturnType<typeof requireSelectedAi>;
  readonly artifactPaging?: unknown;
  readonly researchPaging?: { snapshot: unknown; operationRunId: string };
}) {
  let failed = false;
  const generated = conversationGeneratedTools(
    input.data,
    input.registry,
    { conversationScope: input.observer?.conversationScope },
    input.researchPaging,
    input.artifactPaging,
  );
  const typed = conversationTypedReadContribution(input);
  const external = input.externalTools ?? [];
  const eligibleExternal = input.literatureOnly
    ? external.filter(tool => tool.explicitRoute === 'medical-literature')
    : input.publicSearchSucceeded || !external.some(tool => tool.initialLookup)
      ? external
      : [];
  const tools = [
    ...observeLocalSearchFailures(
      input.researchInputs.wrap([
        ...toolsFor(undefined, input.data, input.registry, 6, true, 'rag'),
        ...generated.tools,
        ...(typed ? [typed.tool] : []),
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
    ...(typed ? eligibleExternal.map(typed.protectExternal) : eligibleExternal),
  ];
  const toolExecution = { tools, typedHeartRateDispatch: typed?.dispatch };
  return {
    tools,
    /** Prepare only from the exact catalog and registry created for this turn.
     * The transport still owns selection, consent, and any later action guards. */
    prepareExecution(
      owner: Pick<
        Parameters<typeof executionOptions>[0],
        'selected' | 'operationRunId' | 'consent' | 'external'
      >,
    ) {
      return executionOptions({
        ...owner,
        ...toolExecution,
        consentPurpose: 'record_conversation',
        registry: input.registry,
      });
    },
    generated,
    localRetrievalFailed: () => failed,
  };
}
