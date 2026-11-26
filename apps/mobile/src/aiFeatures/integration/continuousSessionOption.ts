import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { selectedChatGPTAccountId } from './savedChatGPTModelLabel';
import { warmNativeChatGPTSelection } from './warmNativeChatGPTSelection';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { ConversationSessionOptionInput } from './conversationSessionOptionInput';
import type { requireSelectedAi } from './provider';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';

/** Reuse the validated saved selection, not a label, refresh counter, credential or health payload. */
export function continuousSessionOption(
  selectedAi: (() => Promise<ReturnType<typeof requireSelectedAi>>) | undefined,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
  captureSelectionWitness?: ConversationSessionOptionInput['captureSelectionWitness'],
): Pick<
  ConversationSessionOptions,
  | 'continuousSession'
  | 'prepareWarmSend'
  | 'prepareLocalReportModel'
  | 'captureWarmExecution'
  | 'captureTemplateSelection'
> {
  if (!selectedAi) return {};
  let previous:
    | Awaited<
        ReturnType<NonNullable<ConversationSessionOptions['continuousSession']>>
      >
    | undefined;
  return {
    captureWarmExecution: lease => {
      const target = previous;
      if (
        !target ||
        target.id !== lease.id ||
        target.version !== lease.version ||
        !selectedChatGPTAccountId(target.model) ||
        !target.selectionCurrent?.()
      )
        return;
      return () => previous === target && target.selectionCurrent?.() === true;
    },
    captureTemplateSelection: ({ lease, requestId, providerId, modelId }) => {
      const target = previous;
      if (
        !target ||
        target.id !== lease.id ||
        target.version !== lease.version ||
        target.model.providerId !== providerId ||
        target.model.modelId !== modelId ||
        !target.selectionCurrent?.()
      )
        return;
      // Native selection epoch and committed active request must still match. Do not
      // refresh/adopt a stale lease or use a similarly named replacement provider.
      const current = () =>
        previous === target && target.selectionCurrent?.() === true;
      return {
        current,
        recheckOwner: async signal =>
          current() &&
          !signal.aborted &&
          (await (
            await openStorage()
          ).validateWarmLease(target.model, lease, signal, requestId)) &&
          current() &&
          !signal.aborted,
      };
    },
    async prepareLocalReportModel(lease, signal) {
      const target = previous;
      const selected = target?.selectionCurrent;
      if (
        target?.model.providerId !== APPLE_PROVIDER_ID ||
        target.id !== lease.id ||
        target.version !== lease.version ||
        !selected?.() ||
        signal.aborted
      )
        return;
      const current = () => !signal.aborted && selected();
      const storage = await openStorage();
      if (
        previous !== target ||
        !current() ||
        !(await storage.validateWarmLease(target.model, lease, signal)) ||
        previous !== target ||
        !current()
      )
        return;
      // A benign re-resolution of the same selected provider does not
      // replace this native selection epoch. The binder reproves the new request.
      return { modelId: target.model.modelId, lease, current };
    },
    prepareWarmSend: (lease, signal) =>
      warmNativeChatGPTSelection(previous, lease, signal, openStorage),
    continuousSession: async signal => {
      previous = undefined;
      const witness = captureSelectionWitness?.();
      const selected = await selectedAi();
      if (signal.aborted) throw new Error('Conversation selection cancelled.');
      const model = {
        providerId: selected.provider.id,
        modelId: selected.modelId,
      };
      const lease = await (
        await openStorage()
      ).continuousSession(
        { providerId: selected.provider.id, modelId: selected.modelId },
        createConversationDurableIdentity(),
        new Date().toISOString(),
        signal,
      );
      const current = witness?.(model.providerId);
      return (previous = {
        ...lease,
        model,
        ...(current ? { selectionCurrent: current } : {}),
      });
    },
  };
}
