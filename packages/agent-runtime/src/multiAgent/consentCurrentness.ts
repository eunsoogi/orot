import type { ExecutionConsentPort, OutboundProcessingRequest } from './contracts';

/** A present fence must explicitly allow dispatch. Exceptions and non-boolean results
 * fail closed; omission alone preserves legacy per-invocation consent behavior. */
export function isExecutionConsentCurrent(
  consent: ExecutionConsentPort,
  request: OutboundProcessingRequest,
): boolean {
  try {
    return (
      consent.isAuthorizationCurrent === undefined ||
      consent.isAuthorizationCurrent(request) === true
    );
  } catch {
    return false;
  }
}
