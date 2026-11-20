type Receive = (event: unknown) => Promise<void> | undefined;

export type CaptureVoiceEndReceipt = (callId: string) => Receive | undefined;

/** Retain an old call's witness only while its existing native cleanup retry is pending. */
export function createVoiceStopReceipts() {
  const pending = new Map<string, { readonly receive?: Receive }>();
  return {
    pendingIds: () => pending.keys(),
    async stop(
      callId: string,
      nativeStop: () => Promise<unknown>,
      receive?: Receive,
    ) {
      const attempt = pending.get(callId) ?? { receive };
      pending.set(callId, attempt);
      const event = await nativeStop();
      // Native cleanup and app bridge authority do not depend on the local history writer.
      if (pending.get(callId) === attempt) pending.delete(callId);
      Promise.resolve()
        .then(() => attempt.receive?.(event))
        .catch(() => {});
    },
  };
}
