import { createVoiceEndReceipt } from '../voiceConversation/voiceEndReceipt';
import {
  parseObservedVoiceCaptions,
  type ObservedVoiceCaptions,
} from '../voiceConversation/observedVoiceCaptions';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export type VoiceEndOwnership = {
  current: () => boolean;
  lease?: { readonly id: string; readonly version: number };
  signal: AbortSignal;
  createdAt: string;
  afterMessage: number | null;
  observedVoiceCaptions?: ObservedVoiceCaptions;
};

/** Capture the owner before opening a call. A future producer supplies only
 * an immutable snapshot from that same gracefully closed call. */
export function captureConversationVoiceEnd(ports: {
  valid: () => boolean;
  activeId: () => number;
  find: (id: number) => ConversationSession | undefined;
  retention?: ConversationSessionOptions['retention'];
  voiceOwners: Map<number, AbortController>;
  save: (
    id: number,
    card: string,
    task: { kind: 'voice_end'; durationSeconds: number },
    revision: undefined,
    owner: VoiceEndOwnership,
  ) => Promise<void>;
}) {
  return function captureVoiceEnd(
    sessionId: number,
    callId: string,
    snapshot?: () => unknown,
  ):
    | ((
        event: unknown,
        observedCaptions?: unknown,
      ) => Promise<void> | undefined)
    | undefined {
    const owner = ports.find(sessionId);
    if (
      !ports.valid() ||
      ports.activeId() !== sessionId ||
      !owner ||
      owner.quarantined ||
      owner.restoring ||
      owner.restoreFailed
    )
      return;
    const controller =
      ports.voiceOwners.get(sessionId) ?? new AbortController();
    // An abort stays false across remove/undo, even for a previously empty session.
    ports.voiceOwners.set(sessionId, controller);
    const { signal } = controller;
    const lease = ports.retention?.activeLease(sessionId);
    const current = () => {
      const session = ports.find(sessionId);
      return (
        ports.valid() &&
        !signal.aborted &&
        Boolean(session) &&
        !session?.quarantined &&
        session?.createdAt === owner.createdAt
      );
    };
    const safeSnapshot = () => {
      try {
        return snapshot?.();
      } catch {
        return undefined;
      }
    };
    return createVoiceEndReceipt({
      callId,
      isCurrent: current,
      retain: (duration, observedCaptions) =>
        ports.save(
          sessionId,
          `voice-end:${callId}`,
          { kind: 'voice_end', ...duration },
          undefined,
          {
            current,
            lease: lease ?? undefined,
            signal,
            observedVoiceCaptions: parseObservedVoiceCaptions(
              observedCaptions ?? safeSnapshot(),
              callId,
            ),
            createdAt: new Date().toISOString(),
            afterMessage: ports.find(sessionId)?.messages.at(-1)?.id ?? null,
          },
        ),
    }).accept;
  };
}
