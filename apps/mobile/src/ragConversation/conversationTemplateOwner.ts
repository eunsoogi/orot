import type { RagConversationObserver } from './conversationObserver';
import type { ContinuousConversationStore } from './conversationSelectionReady';
import type { ConversationSessionOptions } from './conversationSessionTypes';

type Model = Pick<
  NonNullable<RagConversationObserver['expectedConversationModel']>,
  'providerId' | 'modelId'
>;
export type TemplateSelectionIdentity = Model & {
  readonly lease: NonNullable<RagConversationObserver['retentionSession']>;
  readonly requestId: string;
};
export interface ConversationTemplateOwner extends Model {
  current(): boolean;
  recheck(signal: AbortSignal): Promise<boolean>;
  watch(retire: () => void): () => void;
}

/** Bind one retained, foreground send without changing how its provider or OS lease was admitted. */
export function captureConversationTemplateOwner(
  store: ContinuousConversationStore,
  options: ConversationSessionOptions,
  epoch: () => number,
  model: Model,
  signal?: AbortSignal,
  observer?: RagConversationObserver,
): ConversationTemplateOwner | undefined {
  const { execution, retention, captureTemplateSelection } = options;
  const lease = observer?.retentionSession;
  const requestId = observer?.retentionRequestId;
  if (
    !signal ||
    !lease ||
    !requestId ||
    !execution ||
    execution.bridgeAvailable !== true
  )
    return;
  const started = epoch();
  const id = store.getSnapshot().activeId;
  const proof = captureTemplateSelection?.({ ...model, lease, requestId });
  if (!proof) return;
  const current = () => {
    const snapshot = store.getSnapshot();
    const active = snapshot.sessions.find(session => session.id === id);
    const latest = retention?.activeLease(id);
    return (
      !signal.aborted &&
      started >= 0 &&
      epoch() === started &&
      execution.currentPhase?.() === 'active' &&
      proof.current() &&
      snapshot.activeId === id &&
      !!active &&
      !active.quarantined &&
      !active.leaseRefreshRequired &&
      !active.modelSelectionPending &&
      !active.modelSelectionFailed &&
      latest?.id === lease.id &&
      latest.version === lease.version
    );
  };
  if (!current()) return;
  return {
    ...model,
    current,
    async recheck(checkSignal) {
      try {
        return (
          !checkSignal.aborted &&
          current() &&
          (await execution.protectedDataAvailable()) === true &&
          !checkSignal.aborted &&
          current() &&
          (await proof.recheckOwner(checkSignal)) &&
          !checkSignal.aborted &&
          current() &&
          (await execution.protectedDataAvailable()) === true &&
          !checkSignal.aborted &&
          current()
        );
      } catch {
        return false;
      }
    },
    watch(retire) {
      // Leaving foreground and returning during an await cannot revive this proposal.
      return execution.subscribe(event => {
        if (
          event.kind === 'phase' ||
          (event.kind === 'protectedData' && !event.available)
        )
          retire();
      });
    },
  };
}
