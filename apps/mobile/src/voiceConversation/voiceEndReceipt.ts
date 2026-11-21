export type CompletedVoiceDuration = {
  readonly durationSeconds: number;
};

/** Accept one native duration for the original protected conversation; never route by activeId. */
export function createVoiceEndReceipt(input: {
  readonly callId: string;
  readonly isCurrent: () => boolean;
  readonly retain: (duration: CompletedVoiceDuration) => Promise<void>;
}) {
  const { callId, isCurrent, retain } = input;
  let settled = false;
  return {
    discard() {
      settled = true;
    },
    accept(event: unknown) {
      if (
        settled ||
        !event ||
        typeof event !== 'object' ||
        Array.isArray(event)
      )
        return;
      const value = event as Record<string, unknown>;
      if (
        !/^[a-z0-9-]{1,128}$/u.test(callId) ||
        Object.keys(value).sort().join(',') !== 'callId,durationSeconds' ||
        value.callId !== callId ||
        typeof value.durationSeconds !== 'number' ||
        !Number.isSafeInteger(value.durationSeconds) ||
        value.durationSeconds < 0
      )
        return;
      settled = true;
      if (!isCurrent()) return;
      return retain({ durationSeconds: value.durationSeconds });
    },
  };
}
