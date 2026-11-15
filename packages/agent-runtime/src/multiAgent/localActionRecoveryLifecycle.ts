import type { MultiAgentCheckpointState } from './contracts';

/** Host-only durable preparation. This runs after fresh consent and before the
 * mutation adapter; it grants no permission and must never dispatch a provider.
 */
export interface LocalActionRecoveryLifecycle {
  readonly beforeLocalAction?: (
    checkpoint: MultiAgentCheckpointState,
    signal: AbortSignal,
  ) => Promise<void>;
}
