import type { JsonObject } from '@orot/model-runtime';
import type { EvidenceBatch } from './evidenceContracts';

/** Explicit local mutations are not evidence-search capabilities. The host owns
 * authorization, source validation and an atomic durable idempotency receipt.
 */
export interface LocalActionTool {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  parseInput(value: unknown): JsonObject | undefined;
  authorize(input: JsonObject, signal: AbortSignal): Promise<boolean>;
  execute(request: {
    readonly input: JsonObject;
    readonly operationRunId: string;
    readonly operationKey: string;
    readonly signal: AbortSignal;
  }): Promise<EvidenceBatch>;
}

/** Checkpoints bind the exact action contract, never a persisted permission grant. */
export function actionContract(actions: readonly LocalActionTool[] = []): string | undefined {
  return actions.length
    ? JSON.stringify(
        actions.map(({ id, version, description, inputSchema }) => ({
          id,
          version,
          description,
          inputSchema,
        })),
      )
    : undefined;
}

/** Mutation results stay in unrestricted personal-record scope, not a read-only source subset. */
export function validLocalActions(
  actions: readonly LocalActionTool[] | undefined,
  scope: import('./evidenceContracts').AllowedEvidenceScope,
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
          typeof action.execute === 'function',
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
