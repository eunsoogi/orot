import type { JsonObject } from '@orot/model-runtime';
import type { EvidenceBatch } from './evidenceContracts';

/** Exact protected receipt; missing proof terminates without provider retry. */
export type ConfirmTerminalLocalAction<TResult> = (request: {
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly input: JsonObject;
  readonly signal: AbortSignal;
}) => Promise<{ readonly value: TResult; readonly committed?: boolean } | undefined>;

export function isTerminalAction(action: LocalActionTool | undefined): boolean {
  return action?.completion === 'host_terminal';
}

export function isNonresumableActionPhase(
  saved: import('./contracts').MultiAgentCheckpointState,
  actions: readonly LocalActionTool[] | undefined,
): boolean {
  return (
    saved.terminal ||
    saved.phase === 'complete' ||
    // A host sidecar depends on an ephemeral composer witness, never a checkpoint.
    !!actions?.some(
      (action) => action.id === saved.selectedToolId && action.completion === 'host_sidecar',
    ) ||
    // Neither cold approval nor in-flight terminal writes reenter the graph.
    (saved.phase === 'local_action' &&
      !!actions?.some((action) => action.id === saved.selectedToolId && isTerminalAction(action)))
  );
}

/** Explicit local mutations are not evidence-search capabilities. The host owns
 * authorization, source validation and an atomic durable idempotency receipt.
 */
export interface LocalActionTool {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  /** Host terminal ends the graph; sidecar returns a closed non-committed status. */
  readonly completion?: 'host_terminal' | 'host_sidecar';
  parseInput(value: unknown): JsonObject | undefined;
  authorize(
    input: JsonObject,
    signal: AbortSignal,
    terminal?: { readonly operationRunId: string; readonly operationKey: string },
  ): Promise<boolean>;
  /** Read only a proven committed result. Never dispatch or backfill an uncertain mutation. */
  recover?(request: {
    readonly evidenceReferences: readonly import('./evidenceContracts').EvidenceReference[];
    readonly input: JsonObject;
    readonly operationRunId: string;
    readonly operationKey: string;
    readonly signal: AbortSignal;
  }): Promise<readonly import('./evidenceContracts').EvidenceReference[] | undefined>;
  /** Reconstruct a committed result whose graph receipt was never persisted. Read-only;
   * undefined means unknown, not permission to execute. Requires fresh authorization.
   */
  recoverResult?(request: {
    readonly input: JsonObject;
    readonly operationRunId: string;
    readonly operationKey: string;
    readonly signal: AbortSignal;
  }): Promise<EvidenceBatch | undefined>;
  execute(request: {
    readonly input: JsonObject;
    readonly operationRunId: string;
    readonly operationKey: string;
    readonly signal: AbortSignal;
  }): Promise<EvidenceBatch & { readonly sidecarStatus?: 'staged' | 'ignored' }>;
}

/** Checkpoints bind the exact action contract, never a persisted permission grant. */
export function actionContract(actions: readonly LocalActionTool[] = []): string | undefined {
  return actions.length
    ? JSON.stringify(
        actions.map(({ id, version, description, inputSchema, completion }) => ({
          id,
          version,
          description,
          inputSchema,
          completion,
        })),
      )
    : undefined;
}

/** Mutation results stay in unrestricted personal-record scope, not a read-only source subset. */
export function validLocalActions(
  actions: readonly LocalActionTool[] | undefined,
  scope: import('./evidenceContracts').AllowedEvidenceScope,
  confirm?: ConfirmTerminalLocalAction<unknown>,
): boolean {
  return (
    !actions?.length ||
    (scope.sourceKinds.includes('personal_record') &&
      !scope.sourceIds &&
      !scope.timeRange &&
      actions.every(
        (action) =>
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(action.id) &&
          action.version.length > 0 &&
          typeof action.authorize === 'function' &&
          typeof action.execute === 'function' &&
          (action.completion === undefined ||
            ((action.completion === 'host_sidecar' ||
              (action.completion === 'host_terminal' && typeof confirm === 'function')) &&
              action.recover === undefined &&
              action.recoverResult === undefined)),
      ))
  );
}

export type MultiAgentPhase =
  | 'task_response'
  | 'evidence_research'
  | 'evidence_search'
  | 'local_action'
  | 'revised_response'
  | 'complete';
