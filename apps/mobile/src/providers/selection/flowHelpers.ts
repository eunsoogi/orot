import { useEffect, useRef } from 'react';
import type { OpenAIAccountSummary } from '../openai';

// Keep account ordering stable and release route-owned OAuth work on unmount.
export function sortAccounts(
  values: readonly OpenAIAccountSummary[],
): readonly OpenAIAccountSummary[] {
  return [...values].sort((left, right) =>
    left.issuedClientID.localeCompare(right.issuedClientID),
  );
}

export function markAccountAsRequiringSignIn(
  issuedClientID: string,
): (
  accounts: readonly OpenAIAccountSummary[],
) => readonly OpenAIAccountSummary[] {
  return accounts =>
    accounts.map(account =>
      account.issuedClientID === issuedClientID
        ? { ...account, requiresSignIn: true }
        : account,
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

export function useCancelSignInOnUnmount(cancelSignIn: () => void): void {
  const cancelSignInRef = useRef(cancelSignIn);
  cancelSignInRef.current = cancelSignIn;

  useEffect(
    () => () => {
      cancelSignInRef.current();
    },
    [],
  );
}
