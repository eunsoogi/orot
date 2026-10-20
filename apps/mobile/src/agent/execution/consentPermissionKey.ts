import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { isReusablePublicWebQuery } from './publicWebQuery';

/** A feature explicitly declares its reusable permission boundary; model-generated content cannot widen it. */
export function consentPermissionKey(
  request: OutboundProcessingRequest,
): string | undefined {
  const scope = request.consentScope;
  // An arbitrary model query cannot classify its own bytes as a reusable public scope.
  if (
    scope?.purpose === 'public_web_search' &&
    !isReusablePublicWebQuery(request)
  )
    return undefined;
  if (
    !scope ||
    !scope.purpose.trim() ||
    !scope.policyVersion.trim() ||
    !scope.dataCategories.length
  )
    return undefined;
  const categories = [...new Set(scope.dataCategories)].sort();
  if (categories.some(value => !value.trim())) return undefined;
  return JSON.stringify({
    receiptVersion: 2,
    providerId: request.providerId,
    modelId: request.modelId,
    recipient: request.recipient,
    purpose: scope.purpose,
    policyVersion: scope.policyVersion,
    dataCategories: categories,
    sourceKinds: [...new Set(request.allowedScope.sourceKinds)].sort(),
  });
}
