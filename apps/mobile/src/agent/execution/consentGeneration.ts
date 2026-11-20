/** Random non-secret generations prevent a cleared/recreated authority from replaying
 * old permission rows. No clock, process counter or credential digest fallback. */
export function createConsentGeneration(): string {
  const crypto = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (target: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (!crypto?.getRandomValues)
    throw new Error('Secure permission identity unavailable');
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
