import type { EvidenceSearchTool } from '@orot/agent-runtime';
import type {
  ConversationToolContext,
  ProtectedConversationToolRead,
} from './conversationToolContext';
import { createConversationHeartRateTool } from '../aiFeatures/integration/conversationHeartRateTool';
import { createTypedHeartRateModelOwner } from '../aiFeatures/integration/conversationHeartRateModelOwner';
import type { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import type { requireSelectedAi } from '../aiFeatures/integration/provider';
import { createTypedHeartRateDispatch } from '../aiFeatures/integration/typedHeartRateReusePolicy';

export type ConversationToolPreparationOwner = Readonly<{
  operationRunId: string;
  signal: AbortSignal;
}>;

/** The existing local-only typed route can reserve an extra zero-transfer model
 * phase. Its model and approval stay in this tool contribution, not in a
 * text/voice transport or in the external-evidence catalog. */
export function conversationTypedReadContribution(input: {
  data: AiFeatureLocalData;
  registry: LocalEvidenceReferenceRegistry;
  observer?: ConversationToolContext;
  selected?: ReturnType<typeof requireSelectedAi>;
  preparationOwner?: ConversationToolPreparationOwner;
  protectedDataAvailable?: ProtectedConversationToolRead;
  literatureOnly?: boolean;
}) {
  const {
    data,
    registry,
    observer,
    preparationOwner,
    selected,
    protectedDataAvailable,
  } = input;
  if (
    !preparationOwner ||
    !protectedDataAvailable ||
    !selected ||
    input.literatureOnly ||
    !data.readHealthContext ||
    !data.acquireHeartRateSourceEpoch ||
    observer?.inputOrigin !== 'composer' ||
    observer.expectedVoiceSelection ||
    observer.photoInput ||
    !observer.confirmTypedHeartRate
  )
    return;
  const model = createTypedHeartRateModelOwner(selected);
  if (!model) return;
  const dispatch = createTypedHeartRateDispatch();
  const tool = createConversationHeartRateTool({
    read: data.readHealthContext,
    acquireSourceEpoch: data.acquireHeartRateSourceEpoch,
    protectedDataAvailable,
    registry,
    owner: preparationOwner,
    model,
    dispatch,
    observer,
  });
  // This existing operation blocks external execution while its protected
  // typed source is active, including a preapproved query's later dispatch.
  const protectExternal = (external: EvidenceSearchTool): EvidenceSearchTool =>
    external.execution !== 'external_read_only'
      ? external
      : {
          ...external,
          async search(...args: Parameters<typeof external.search>) {
            if (dispatch.active()) return { status: 'consent_required' };
            return external.search(...args);
          },
          ...(external.prepareAuthorizedSearch
            ? {
                async prepareAuthorizedSearch(
                  ...args: Parameters<
                    NonNullable<typeof external.prepareAuthorizedSearch>
                  >
                ) {
                  if (dispatch.active())
                    return { status: 'consent_required' as const };
                  const prepared = await external.prepareAuthorizedSearch!(
                    ...args,
                  );
                  if (prepared.status !== 'authorized') return prepared;
                  return {
                    status: 'authorized' as const,
                    dispatch: async () =>
                      dispatch.active()
                        ? { status: 'consent_required' as const }
                        : prepared.dispatch(),
                  };
                },
              }
            : {}),
        };
  return { tool, dispatch, protectExternal };
}
