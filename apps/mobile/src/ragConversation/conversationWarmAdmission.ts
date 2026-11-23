import { captureConversationTemplateOwner } from './conversationTemplateOwner';
import type { RagConversationObserver } from './conversationObserver';
import type { ContinuousConversationStore } from './conversationSelectionReady';
import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export interface WarmConversationSelectionProof {
  current(): boolean;
  recheckOwner(signal: AbortSignal): Promise<boolean>;
}
export type WarmConversationPreparation = WarmConversationSelectionProof & {
  readonly kind: 'warm-local';
};

/** A warm fast path is one-shot local admission of the already visible owner.
 * It never runs selection/attachment mutations or replaces late model resolution.
 */
export function createConversationWarmAdmission(
  store: ContinuousConversationStore,
  options: ConversationSessionOptions,
  epoch: () => number,
  strict: (id: number, signal?: AbortSignal) => Promise<boolean>,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  return {
    async prepare(
      id: number,
      signal?: AbortSignal,
      allowed = false,
    ): Promise<boolean | WarmConversationPreparation> {
      const started = epoch();
      const lease = options.retention?.activeLease(id);
      const activeOwner = () => {
        const snapshot = store.getSnapshot();
        const active = snapshot.sessions.find(session => session.id === id);
        const latest = options.retention?.activeLease(id);
        return !signal?.aborted &&
          snapshot.activeId === id &&
          active &&
          !active.quarantined &&
          !active.leaseRefreshRequired &&
          latest?.id === lease?.id &&
          latest?.version === lease?.version
          ? active
          : undefined;
      };
      const hasOwner = () => {
        const active = activeOwner();
        return (
          !!active &&
          started >= 0 &&
          epoch() === started &&
          !active.modelSelectionPending &&
          !active.modelSelectionFailed &&
          !active.restoring &&
          !active.restoreFailed
        );
      };
      if (
        !allowed ||
        !signal ||
        !lease ||
        !options.prepareWarmSend ||
        !hasOwner()
      )
        return strict(id, signal);
      try {
        const proof = await options.prepareWarmSend(lease, signal);
        if (!hasOwner()) return false;
        if (!proof) return strict(id, signal);
        if (!proof.current()) return false;
        // Cosmetic same-owner model checks do not invalidate an active request.
        return {
          kind: 'warm-local',
          current: () => Boolean(activeOwner()) && proof.current(),
          recheckOwner: proof.recheckOwner,
        };
      } catch (error) {
        if (hasOwner()) update(id, { modelSelectionFailed: true });
        throw error;
      }
    },
    binder(
      resolveModel: () => RagConversationObserver['expectedConversationModel'],
    ) {
      return (
        sender: ConversationSender,
        warm?: WarmConversationPreparation,
      ): ConversationSender => {
        const model = resolveModel();
        if (!model && !warm) return sender;
        return async (question, history, signal, observer) => {
          const current = () =>
            Boolean(signal && !signal.aborted && warm?.current());
          const recheck = async () => {
            try {
              return Boolean(
                signal &&
                current() &&
                (await warm?.recheckOwner(signal)) &&
                current(),
              );
            } catch {
              return false; // No positive owner witness can be inferred from a failed protected read.
            }
          };
          if (warm && (!model || !(await recheck())))
            return {
              status: 'failure',
              kind: signal?.aborted ? 'cancelled' : 'provider_unavailable',
            };
          return sender(question, history, signal, {
            ...observer,
            ...(model
              ? {
                  templateProposalOwner: captureConversationTemplateOwner(
                    store,
                    options,
                    epoch,
                    model,
                    signal,
                    observer,
                  ),
                }
              : {}),
            expectedConversationModel:
              model && warm
                ? { ...model, isCurrent: current, isDurablyCurrent: recheck }
                : model,
          });
        };
      };
    },
  };
}
