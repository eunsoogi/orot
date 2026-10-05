import type { OpenAIAccountSummary } from '../openai';

// Keep account ordering stable and recognize only the explicit OAuth cancel sentinel.
export function sortAccounts(
  values: readonly OpenAIAccountSummary[],
): readonly OpenAIAccountSummary[] {
  return [...values].sort((left, right) =>
    left.issuedClientID.localeCompare(right.issuedClientID),
  );
}

export function isSignInCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'CHATGPT_AUTH_CANCELLED'
  );
}
