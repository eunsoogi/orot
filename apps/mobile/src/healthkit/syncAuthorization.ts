import type { HealthKitAuthorizationResult } from './types';

export interface ResolveHealthKitSyncAuthorizationOptions {
  readonly permissionPreviouslyRequested?: boolean;
  readonly authorization?: HealthKitAuthorizationResult;
  readonly requestAuthorization?: () => Promise<HealthKitAuthorizationResult>;
  readonly onRequestCompleted?: () => Promise<void>;
  readonly missingRequestMessage: string;
}

/** Reuses a prior request and records explicit intent without asserting a read grant. */
export async function resolveHealthKitSyncAuthorization(
  options: ResolveHealthKitSyncAuthorizationOptions,
): Promise<HealthKitAuthorizationResult | undefined> {
  if (options.permissionPreviouslyRequested === true) return undefined;

  let authorization = options.authorization;
  if (!authorization) {
    if (!options.requestAuthorization) {
      throw new Error(options.missingRequestMessage);
    }
    authorization = await options.requestAuthorization();
  }

  if (
    authorization.availability === 'available' &&
    authorization.requestStatus === 'completed'
  ) {
    await options.onRequestCompleted?.();
  }
  return authorization;
}
