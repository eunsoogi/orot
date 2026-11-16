import { AppState } from 'react-native';
import type { RefObject } from 'react';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import type { RealtimeToolRequest } from './realtimeToolRequests';
import { entryIntentSender } from '../ragConversation/entryIntentSender';

let nextApproval = 0;
/** Delegate only confirmed original speech, then separately authorize its exact result to the voice recipient. */
export function createRealtimeConversationTool(input: {
  latest: RefObject<ConversationVoiceProps>;
  model: string;
  current: () => boolean;
  ownsRequest: (requestId: number | null, expected?: number | null) => void;
  confirm: (request: {
    text: string;
    recipient: string;
    model: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
}) {
  return async (
    question: string,
    request: RealtimeToolRequest,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    const initial = input.latest.current;
    const version = initial.selectionRevision;
    const sessionId = initial.sessionId;
    const current = () =>
      !signal.aborted &&
      AppState.currentState === 'active' &&
      input.current() &&
      input.latest.current.sessionId === sessionId &&
      input.latest.current.selectionRevision === version;
    if (
      !current() ||
      !question.trim() ||
      question.length > 1000 ||
      !initial.confirmRealtimeResult ||
      initial.store.getSnapshot().sessions.find(item => item.id === sessionId)
        ?.busy
    )
      return;
    const selected = await initial.resolveSelectedAi();
    if (selected.status !== 'ready' || !current()) return;
    if (
      !(await input.confirm({
        text: question,
        recipient: selected.recipient,
        model: selected.modelId,
        signal,
      })) ||
      !current()
    )
      return;
    const liveSelection = await input.latest.current.resolveSelectedAi();
    if (
      !current() ||
      liveSelection.status !== 'ready' ||
      liveSelection.provider.id !== selected.provider.id ||
      liveSelection.modelId !== selected.modelId ||
      liveSelection.recipient !== selected.recipient
    )
      return;
    const live = input.latest.current;
    const send = entryIntentSender(live.store, sessionId, live.onSend);
    const handle = live.store.sendOwnedPrompt(
      sessionId,
      question,
      (text, history, requestSignal, observer) =>
        send(text, history, requestSignal, {
          ...observer,
          expectedVoiceSelection: {
            providerId: selected.provider.id,
            modelId: selected.modelId,
          },
        }),
    );
    const admitted = live.store
      .getSnapshot()
      .sessions.find(item => item.id === sessionId)?.requestActivity;
    input.ownsRequest(admitted?.requestId ?? null);
    const cancel = () => {
      handle.cancel();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await handle.completion;
      if (!current() || result.status !== 'completed' || !result.answer.trim())
        return;
      const output = JSON.stringify({
        status: 'completed',
        answer: result.answer,
      });
      // Never silently truncate a medically relevant answer or export streaming/tool/source internals.
      if (
        encodeURIComponent(output).replace(/%[A-F\d]{2}/gi, 'x').length > 16384
      )
        return;
      const authorization: OutboundProcessingRequest = {
        operationRunId: `realtime-result-${Date.now()}-${++nextApproval}`,
        providerId: 'openai-realtime',
        modelId: input.model,
        recipient: 'OpenAI Realtime API',
        remoteProcessing: true,
        allowedScope: {
          sourceKinds: ['personal_record', 'generated_artifact'],
        },
        payload: { messages: [{ role: 'user', content: output }] },
        signal,
      };
      // No consentScope: a saved purpose permission must not approve this new recipient/payload automatically.
      const snapshot = JSON.stringify(authorization);
      if (
        !(await live.confirmRealtimeResult!(authorization)) ||
        !current() ||
        JSON.stringify(authorization) !== snapshot
      )
        return;
      // A reviewed answer can become stale while its disclosure is open. Re-read only this
      // handle's protected completion; never rerun the workflow or substitute a changed answer.
      // This proves freshness at the read, not atomicity with a later native socket send.
      // The call/foreground lease remains independently enforced at that send boundary.
      if (
        typeof handle.readCurrentCompletion !== 'function' ||
        (await handle.readCurrentCompletion()) !== result.answer ||
        !current()
      )
        return;
      return output;
    } finally {
      signal.removeEventListener('abort', cancel);
      input.ownsRequest(null, admitted?.requestId ?? null);
    }
  };
}
