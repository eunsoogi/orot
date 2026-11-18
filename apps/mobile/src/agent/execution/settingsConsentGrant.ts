import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { isReusablePublicWebQuery } from './publicWebQuery';

/** A credential epoch is a non-secret, durable identity, never a key or token digest. */
export interface SettingsConsentIdentity {
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly authorityGeneration: string;
  readonly credentialEpoch: string;
}

export interface SettingsConsentPermission {
  readonly purpose: string;
  readonly policyVersion: string;
  readonly dataCategories: readonly string[];
  readonly sourceKinds: readonly string[];
}

/** Only explicit settings confirmation may create this versioned activation record.
 * Record IDs and payloads deliberately do not belong to a continuing permission. */
export interface SettingsConsentGrant {
  readonly version: 1;
  readonly catalogVersion: string;
  readonly identity: SettingsConsentIdentity;
  readonly permissions: readonly SettingsConsentPermission[];
}

const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value === value.trim();
const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(nonempty) &&
  new Set(value).size === value.length;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');

/** Strict parsing rejects older receipts, unknown fields and partially persisted grants.
 * Parsing is not authorization: the active selection, epoch and catalog remain live inputs. */
export function parseSettingsConsentGrant(
  value: unknown,
): SettingsConsentGrant | null {
  if (
    !record(value) ||
    !keys(value, ['version', 'catalogVersion', 'identity', 'permissions']) ||
    value.version !== 1 ||
    !nonempty(value.catalogVersion) ||
    !record(value.identity) ||
    !keys(value.identity, [
      'providerId',
      'modelId',
      'recipient',
      'authorityGeneration',
      'credentialEpoch',
    ]) ||
    !Object.values(value.identity).every(nonempty) ||
    !Array.isArray(value.permissions) ||
    value.permissions.length === 0
  )
    return null;
  const permissions: SettingsConsentPermission[] = [];
  for (const item of value.permissions) {
    if (
      !record(item) ||
      !keys(item, [
        'purpose',
        'policyVersion',
        'dataCategories',
        'sourceKinds',
      ]) ||
      !nonempty(item.purpose) ||
      !nonempty(item.policyVersion) ||
      !strings(item.dataCategories) ||
      !strings(item.sourceKinds)
    )
      return null;
    permissions.push({
      purpose: item.purpose,
      policyVersion: item.policyVersion,
      dataCategories: [...item.dataCategories],
      sourceKinds: [...item.sourceKinds],
    });
  }
  const identity = value.identity;
  return {
    version: 1,
    catalogVersion: value.catalogVersion,
    identity: {
      providerId: String(identity.providerId),
      modelId: String(identity.modelId),
      recipient: String(identity.recipient),
      authorityGeneration: String(identity.authorityGeneration),
      credentialEpoch: String(identity.credentialEpoch),
    },
    permissions,
  };
}

/** Compare only declared permission boundaries. The caller must still perform exact
 * payload, cancellation, live selection and source/deletion checks at dispatch. */
export function settingsGrantCoversRequest(
  grant: SettingsConsentGrant,
  identity: SettingsConsentIdentity,
  catalogVersion: string,
  request: OutboundProcessingRequest,
): boolean {
  const parsed = parseSettingsConsentGrant(grant);
  const scope = request.consentScope;
  if (
    !parsed ||
    parsed.catalogVersion !== catalogVersion ||
    !scope ||
    request.signal.aborted ||
    !nonempty(identity.authorityGeneration) ||
    !strings(scope.dataCategories) ||
    !strings(request.allowedScope.sourceKinds)
  )
    return false;
  if (
    Object.entries(identity).some(
      ([key, value]) =>
        parsed.identity[key as keyof SettingsConsentIdentity] !== value,
    )
  )
    return false;
  if (
    request.providerId !== identity.providerId ||
    request.modelId !== identity.modelId ||
    request.recipient !== identity.recipient
  )
    return false;
  if (
    scope.purpose === 'public_web_search' &&
    !isReusablePublicWebQuery(request)
  )
    return false;
  return parsed.permissions.some(
    permission =>
      permission.purpose === scope.purpose &&
      permission.policyVersion === scope.policyVersion &&
      scope.dataCategories.every(category =>
        permission.dataCategories.includes(category),
      ) &&
      request.allowedScope.sourceKinds.every(kind =>
        permission.sourceKinds.includes(kind),
      ),
  );
}
