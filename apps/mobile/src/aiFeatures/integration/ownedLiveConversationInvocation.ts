import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import { createConversationToolBundle } from './conversationToolBundle';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import { createResearchInputTracker } from './researchInputTracker';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';

type LocalToolDefinition = Readonly<
  Pick<EvidenceSearchTool, 'id' | 'sourceKind' | 'inputSchema'>
>;

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
  readonly permits: (tool: LocalToolDefinition) => boolean;
  readonly beforeRead: (signal: AbortSignal) => Promise<boolean>;
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
    external: { tools: [], publicWebTool: undefined },
    publicSearchSucceeded: false,
  });
  if (new Set(tools.map(tool => tool.id)).size !== tools.length) return;

  const selected = tools.flatMap(tool => {
    const { id, sourceKind, inputSchema } = tool;
    const definition = { id, sourceKind, inputSchema };
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
          const { signal } = args[0];
          const mayRead = () => !signal.aborted && current();
          if (
            !mayRead() ||
            (await input.beforeRead(signal)) !== true ||
            !mayRead()
          )
            return { status: 'consent_required' as const };
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
