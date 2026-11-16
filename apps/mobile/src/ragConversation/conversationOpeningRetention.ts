/** Reviewed opening prose is optional display metadata, never answer/history evidence.
 * Revocation is permanent for this attempt; late events cannot restore deleted metadata. */
export function createConversationOpeningRetention() {
  let opening: { callId: string; text: string } | undefined;
  let revoked = false;
  return {
    retainOpening(value: { callId: string; text: string }) {
      if (
        !revoked &&
        value.callId &&
        value.callId.length <= 200 &&
        value.text.trim() &&
        value.text.length <= 300
      )
        opening ??= { callId: value.callId, text: value.text };
    },
    discardOpening() {
      revoked = true;
      opening = undefined;
    },
    withoutRevokedOpening<T extends { initialResponse?: unknown }>(
      value: T,
    ): T {
      if (!revoked || !value.initialResponse) return value;
      return { ...value, initialResponse: undefined };
    },
    openingMetadata: () => (opening ? { initialResponse: opening } : {}),
  };
}
