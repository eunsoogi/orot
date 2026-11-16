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
