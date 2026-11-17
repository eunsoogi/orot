import { providerDiagnostic } from './diagnostics';

/** Only known optional-search failures reach this sink; never forward an exception or query. */
export function reportPublicSearchFailure(
  reason: 'timeout' | 'offline' | 'unavailable',
) {
  if (!['timeout', 'offline', 'unavailable'].includes(reason)) return;
  try {
    providerDiagnostic('rag', 'public_search', reason);
  } catch {
    // Optional native diagnostics must not prevent the local-answer fallback.
  }
}

/** Attribute a fixed provider result to public search, without forwarding its
 * message or implying that the rest of the conversation failed. Native already
 * allowlists these outcome tokens independently. */
export function reportPublicSearchProviderFailure(code: string) {
  const known = [
    'provider_unavailable',
    'rate_limited',
    'authentication_required',
    'credential_unavailable',
    'unsupported_capability',
    'unsupported_input',
    'invalid_request',
    'internal_error',
    'safety_refusal',
    'invalid_provider',
  ] as const;
  const outcome = known.find(value => value === code);
  if (!outcome) return;
  try {
    providerDiagnostic('rag', 'public_search', outcome);
  } catch {
    // Optional observation never changes dispatch or recovery.
  }
}
