import type { RealtimeTranscript } from './nativeRealtimeVoice';

export interface RealtimeToolRequest {
  readonly callId: string;
  readonly responseId: string;
  readonly toolCallId: string;
  readonly inputItemId: string;
}
export interface RealtimeToolNative {
  cancel(callId: string): Promise<void>;
  onToolCall(listener: (request: RealtimeToolRequest) => void): () => void;
  onToolCancelled(
    listener: (callId: string, toolCallId: string) => void,
  ): () => void;
  resolveToolCall(
    request: RealtimeToolRequest,
    output: string,
  ): Promise<boolean>;
}

/** Native binds the response to committed input; only a finalized user transcript can authorize work. */
export function createRealtimeToolRequests(input: {
  native: RealtimeToolNative;
  current: (callId: string) => boolean;
  execute: (
    question: string,
    request: RealtimeToolRequest,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}) {
  const transcripts = new Map<string, string>();
  const consumed = new Set<string>();
  let disposed = false;
  let pending:
    | {
        request: RealtimeToolRequest;
        abort: AbortController;
        wake?: () => void;
      }
    | undefined;
  const cancel = () => {
    const hadPending = Boolean(pending);
    pending?.abort.abort();
    pending?.wake?.();
    pending = undefined;
    transcripts.clear();
    return hadPending;
  };
  const run = async (request: RealtimeToolRequest) => {
    if (disposed || pending || !input.current(request.callId)) return;
    const key = `${request.callId}:${request.inputItemId}`;
    // A denied or uncertain dispatch never becomes permission to execute the same spoken request again.
    if (consumed.has(key) || consumed.size >= 64) return;
    consumed.add(key);
    const operation = {
      request,
      abort: new AbortController(),
      wake: undefined as (() => void) | undefined,
    };
    pending = operation;
    const valid = () =>
      pending === operation &&
      !operation.abort.signal.aborted &&
      input.current(request.callId);
    try {
      if (!transcripts.has(key)) {
        // Transcription completion can follow the model's function call. Never substitute generated arguments.
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 3000);
          operation.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      const text = transcripts.get(key);
      if (!valid() || !text?.trim() || text.length > 1000) return;
      const output = await input.execute(text, request, operation.abort.signal);
      if (!valid()) return;
      await input.native.resolveToolCall(
        request,
        output ?? '{"status":"not_authorized"}',
      );
    } catch {
      // Provider/consent errors can contain records or secrets; no exception text crosses the socket.
    } finally {
      if (pending === operation) {
        operation.abort.abort();
        pending = undefined;
      }
    }
  };
  const off = [
    input.native.onToolCall(request => {
      run(request).catch(() => {});
    }),
    input.native.onToolCancelled((callId, toolCallId) => {
      if (
        pending?.request.callId === callId &&
        pending.request.toolCallId === toolCallId
      )
        cancel();
    }),
  ];
  return {
    observe(event: RealtimeTranscript) {
      if (disposed || event.role !== 'user' || !input.current(event.callId))
        return;
      const key = `${event.callId}:${event.itemId}`;
      // Finalized transcription is immutable, including a later conflicting duplicate.
      if (!transcripts.has(key)) transcripts.set(key, event.text);
      while (transcripts.size > 20)
        transcripts.delete(transcripts.keys().next().value!);
      if (
        pending?.request.callId === event.callId &&
        pending.request.inputItemId === event.itemId
      )
        pending.wake?.();
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
      transcripts.clear();
      off.forEach(unsubscribe => unsubscribe());
    },
  };
}
