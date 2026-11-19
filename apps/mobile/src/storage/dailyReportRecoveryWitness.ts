/** Comparison metadata is not authority. Only the current production owner can issue this witness.
 * This storage API deliberately has no provider, authorize, or conversation-resume dependency. */
export interface DailyReportRecoveryWitness {
  readonly identity: {
    readonly key: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly authorizationRevision: string;
  };
  isCurrent(): boolean;
  subscribeInvalidation(listener: () => void): () => void;
}
export function currentDailyRecoveryOwner(
  owner: DailyReportRecoveryWitness,
  signal: AbortSignal,
) {
  try {
    return !signal.aborted && owner.isCurrent() === true;
  } catch {
    return false;
  }
}
