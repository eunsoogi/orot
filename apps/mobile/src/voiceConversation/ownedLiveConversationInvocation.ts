import type {
  EvidenceBatch,
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type {
  CurrentConversationRead,
  OwnedConversationReadTool,
} from '../conversationTools/ownedConversationReadSelection';
import { createConversationToolBundle } from '../conversationTools/conversationToolBundle';
import type { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { createResearchInputTracker } from '../aiFeatures/integration/researchInputTracker';
import type { RagConversationObserver } from '../ragConversation/conversationObserver';

/** Bind the stock text Conversation read catalog to an already-owned Live graph.
 * 'local_read_only' is a runtime class, not proof of admission: a catalog tool
 * can still update its local index or need separate selected-source authority.
 * The host must positively permit each exact tool for the current verified
 * registration. Neither this adapter nor its result observer grants transfer. */
export function bindOwnedLiveConversationInvocation(input: {
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly observer?: RagConversationObserver;
  readonly current: () => boolean;
  readonly permits: (tool: OwnedConversationReadTool) => boolean;
  readonly beforeRead: (
    signal: AbortSignal,
    request: EvidenceSearchRequest,
    tool: OwnedConversationReadTool,
  ) => Promise<boolean | CurrentConversationRead>;
  readonly didRead?: (id: string, result: EvidenceBatch) => void;
}): readonly EvidenceSearchTool[] | undefined {
  if (input.current() !== true) return;
  const { data, registry, observer } = input;
  const { tools } = createConversationToolBundle({
    data,
    registry,
    observer,
    researchInputs: createResearchInputTracker(
      registry,
      data,
      observer?.conversationScope,
    ),
    // External and extra-model preparation keep their existing separate owners.
    publicSearchSucceeded: false,
  });
  if (new Set(tools.map(tool => tool.id)).size !== tools.length) return;

  const selected = tools.flatMap(tool => {
    const { id, sourceKind, inputSchema } = tool;
    const definition = {
      id,
      sourceKind,
      inputSchema,
      parseInput: (value: unknown) => tool.parseInput(value),
    };
    const current = () =>
      input.current() === true && input.permits(definition) === true;
    if (
      tool.execution !== 'local_read_only' ||
      tool.additionalModelCalls ||
      tool.prepareAuthorizedSearch ||
      !current()
    )
      return [];

    return [
      {
        ...tool,
        // The graph uses the stock schema/binder and its ordinary authorization
        // first. This second owner/source fence covers the last awaited handoff.
        async search(...args: Parameters<EvidenceSearchTool['search']>) {
          const request = args[0];
          const { signal } = request;
          const owns = () => !signal.aborted && current();
          if (!owns()) return { status: 'consent_required' as const };
          const proof = await input.beforeRead(signal, request, definition);
          const mayRead = () =>
            owns() && (proof === true || (proof !== false && proof.current()));
          if (!mayRead()) return { status: 'consent_required' as const };
          const result = await tool.search(...args);
          if (!mayRead()) return { status: 'consent_required' as const };
          if (!('status' in result)) input.didRead?.(id, result);
          return mayRead() ? result : { status: 'consent_required' as const };
        },
      },
    ];
  });
  return selected.length && input.current() === true ? selected : undefined;
}
