/** A turn belongs to one session and selected provider for its entire lifetime. */
export interface VoiceIdentity {
  readonly sessionId: number;
  readonly providerId: string;
  readonly turnId: string;
}

/** Compare all ownership fields before accepting asynchronous callbacks. */
export function sameVoiceIdentity(a: VoiceIdentity, b: VoiceIdentity): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.providerId === b.providerId &&
    a.turnId === b.turnId
  );
}
