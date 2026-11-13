import { AppState } from 'react-native';
import type { RefObject } from 'react';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import type { ConversationScreenProps } from '../ragConversation/ConversationScreenProps';
import type { ConversationSessions } from '../ragConversation/conversationSessionTypes';
import { entryIntentSender } from '../ragConversation/entryIntentSender';
import type { VoiceConversationDependencies } from './createVoicePorts';

export interface ConversationVoiceProps {
  readonly store: ConversationSessions;
  readonly sessionId: number;
  readonly busy: boolean;
  readonly photoPending: boolean;
  readonly isEntryCurrent?: () => boolean;
  readonly selectionRevision: number;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly onSend: ConversationScreenProps['onSend'];
}
export type VoiceSelection = Extract<SelectedAiResolution, { status: 'ready' }>;
export type SelectionBinding = {
  value: VoiceSelection;
  revision: number;
  sessionId: number;
};
type Owned = {
  turnId: string;
  handle: ReturnType<ConversationSessions['sendOwnedPrompt']>;
};

/** Keeps the approved selection bound through the existing request's durable completion. */
export function conversationVoiceDependencies(input: {
  native: VoiceConversationDependencies['native'];
  latest: RefObject<ConversationVoiceProps>;
  selected: RefObject<SelectionBinding | null>;
  owned: RefObject<Owned | null>;
}): VoiceConversationDependencies {
  const { latest, selected, owned } = input;
  const current: VoiceConversationDependencies['isCurrent'] = identity => {
    const value = selected.current;
    const live = latest.current;
    const snapshot = live.store.getSnapshot();
    const session = snapshot.sessions.find(
      item => item.id === identity.sessionId,
    );
    return Boolean(
      value &&
      value.sessionId === identity.sessionId &&
      value.value.provider.id === identity.providerId &&
      value.revision === live.selectionRevision &&
      live.sessionId === identity.sessionId &&
      snapshot.activeId === identity.sessionId &&
      session &&
      !session.quarantined &&
      !session.restoring &&
      !session.restoreFailed &&
      !session.retryingSave &&
      !(session.restoreAfterRetry && session.unsavedCount) &&
      (live.isEntryCurrent?.() ?? true) &&
      AppState.currentState !== 'background',
    );
  };
  return {
    native: input.native,
    language: 'ko-KR',
    isCurrent: current,
    photoPending: id =>
      latest.current.sessionId !== id ||
      latest.current.photoPending ||
      latest.current.store.photoDrafts.get(id).status !== 'empty',
    async authorize(identity, signal) {
      if (signal.aborted || !current(identity)) return false;
      const result = await latest.current.resolveSelectedAi();
      const approved = selected.current?.value;
      return Boolean(
        !signal.aborted &&
        current(identity) &&
        approved &&
        result.status === 'ready' &&
        result.provider.id === approved.provider.id &&
        result.modelId === approved.modelId,
      );
    },
    async submit(identity, text, signal) {
      const live = latest.current;
      const approved = selected.current?.value;
      if (!approved || signal.aborted || !current(identity))
        throw new Error('Voice selection changed');
      const send = entryIntentSender(
        live.store,
        identity.sessionId,
        live.onSend,
      );
      const handle = live.store.sendOwnedPrompt(
        identity.sessionId,
        text,
        (question, history, requestSignal, observer) =>
          send(question, history, requestSignal, {
            ...observer,
            expectedVoiceSelection: {
              providerId: approved.provider.id,
              modelId: approved.modelId,
            },
          }),
      );
      owned.current = { turnId: identity.turnId, handle };
      if (signal.aborted) handle.cancel();
      const result = await handle.completion;
      if (owned.current?.handle === handle) owned.current = null;
      if (result.status !== 'completed' || signal.aborted || !current(identity))
        throw new Error('Voice answer unavailable');
      return result.answer;
    },
    async cancel(identity) {
      if (owned.current?.turnId === identity.turnId)
        owned.current.handle.cancel();
    },
  };
}
