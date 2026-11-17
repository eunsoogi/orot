import type { ProviderError } from '@orot/model-runtime';

/** A closed cause produced only after the provider reports an explicit offline error. */
export class PublicSearchOfflineError extends Error {}

/** App-owned retrieval limitations only, never provider exception text. */
export const publicSearchFailureGaps = {
  timeout: 'Public web search timed out; no external evidence was retrieved.',
  offline:
    'Public web search was unavailable offline; no external evidence was retrieved.',
  unavailable:
    'Public web search was unavailable; no external evidence was retrieved.',
} as const;

/** These explicit failures invalidate only the isolated optional read. Do not
 * retry, reuse its payload, or recover refusal/configuration/programmer errors. */
export function permitsPublicSearchFallback(error: ProviderError): boolean {
  return [
    'provider_unavailable',
    'rate_limited',
    'authentication_required',
    'credential_unavailable',
    'unsupported_capability',
    'unsupported_input',
    'invalid_request',
  ].includes(error.code);
}
