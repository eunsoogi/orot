/** Allocate identities locally once per generated candidate, independent of text and ordering. */
export function createQuestionIdentity(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `visit-question:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
