/** Durable identities must not depend on wall-clock time or a process-local counter. */
export function createConversationDurableIdentity(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `conversation:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
