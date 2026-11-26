import { createTypedHeartRateDispatch } from './typedHeartRateReusePolicy';
import { createConversationHeartRateTool } from './conversationHeartRateTool';
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
  readonly external: Pick<
    ReturnType<typeof conversationExternalEvidence>,
    'tools' | 'publicWebTool' | 'createTypedHeartRateOwner'
  >;
  readonly publicSearchSucceeded: boolean;
  readonly literatureOnly?: boolean;
  readonly typedHeartRateOwner?: {
    readonly operationRunId: string;
    readonly signal: AbortSignal;
  };
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
  const typedModel =
    input.typedHeartRateOwner && input.external.createTypedHeartRateOwner?.();
  const typedHeartRateDispatch = typedModel
    ? createTypedHeartRateDispatch()
    : undefined;
  const typed =
    typedHeartRateDispatch &&
    typedModel &&
    input.typedHeartRateOwner &&
    !input.literatureOnly &&
    input.data.readHealthContext &&
    input.data.acquireHeartRateSourceEpoch &&
    input.observer?.inputOrigin === 'composer' &&
    !input.observer.expectedVoiceSelection &&
    !input.observer.photoInput &&
    input.observer.confirmTypedHeartRate
      ? createConversationHeartRateTool({
          read: input.data.readHealthContext,
          acquireSourceEpoch: input.data.acquireHeartRateSourceEpoch,
          registry: input.registry,
          owner: input.typedHeartRateOwner,
          model: typedModel,
          dispatch: typedHeartRateDispatch,
          observer: input.observer,
        })
      : undefined;
  const external = input.external.tools.map(tool =>
    typed && tool.execution === 'external_read_only'
      ? {
          ...tool,
          async search(...args: Parameters<typeof tool.search>) {
            if (typedHeartRateDispatch?.active())
              return { status: 'consent_required' as const };
            return tool.search(...args);
          },
          ...(tool.prepareAuthorizedSearch
            ? {
                async prepareAuthorizedSearch(
                  ...args: Parameters<
                    NonNullable<typeof tool.prepareAuthorizedSearch>
                  >
                ) {
                  if (typedHeartRateDispatch?.active())
                    return { status: 'consent_required' as const };
                  const prepared = await tool.prepareAuthorizedSearch!(...args);
                  if (prepared.status !== 'authorized') return prepared;
                  return {
                    status: 'authorized' as const,
                    dispatch: async () =>
                      typedHeartRateDispatch?.active()
                        ? { status: 'consent_required' as const }
                        : prepared.dispatch(),
                  };
                },
              }
            : {}),
        }
      : tool,
  );
  const tools = [
    ...observeLocalSearchFailures(
      input.researchInputs.wrap([
        ...toolsFor(undefined, input.data, input.registry, 6, true, 'rag'),
        ...generated.tools,
        ...(typed ? [typed] : []),
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
      ? external.filter(tool => tool.id === europePmcConversationTool)
      : input.publicSearchSucceeded || !input.external.publicWebTool
        ? external
        : []),
  ];
  return {
    tools,
    toolExecution: { tools, typedHeartRateDispatch },
    generated,
    localRetrievalFailed: () => failed,
  };
}
