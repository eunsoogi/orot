import type { WorkflowOperationIdentity } from '@orot/agent-runtime';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

type Row = Record<string, SqlValue>;
// Structural corruption is rejected before source adapters see stored references.
function validReference(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    [
      'personal_record',
      'reviewed_memory',
      'generated_artifact',
      'external_medical',
    ].includes(String(ref.sourceKind)) &&
    ['sourceId', 'sourceRevision', 'evidenceId', 'evidenceRevision'].every(
      key => typeof ref[key] === 'string' && ref[key].length > 0,
    ) &&
    ['reviewed', 'unreviewed', 'unknown'].includes(String(ref.reviewState)) &&
    (ref.effectiveTime === null || typeof ref.effectiveTime === 'string') &&
    Object.hasOwn(ref, 'locator')
  );
}
/** Read private prepared inputs only between two live-owner/epoch checks. Never returns a dispatch intent or result. */
export function preparedConversationOperation(input: {
  database: SqlDatabase;
  live(sql: SqlExecutor, epoch: number): Promise<boolean>;
  row(
    sql: SqlExecutor,
    identity: WorkflowOperationIdentity,
  ): Promise<Row | undefined>;
  valid(identity: WorkflowOperationIdentity): Promise<number | undefined>;
}) {
  return async (
    operationId: string,
  ): Promise<WorkflowOperationIdentity | undefined> => {
    if (
      typeof operationId !== 'string' ||
      !operationId ||
      operationId.length > 300
    )
      return undefined;
    let snapshot: Row | undefined;
    let epoch: number | undefined;
    const lookup: WorkflowOperationIdentity = {
      operationId,
      input: '',
      evidenceReferences: [],
    };
    await input.database.transaction(async sql => {
      const current = (
        await sql.execute(
          'SELECT value FROM conversation_journal_epoch WHERE id = 1',
        )
      ).rows[0]?.value;
      if (typeof current !== 'number' || !(await input.live(sql, current)))
        return;
      const candidate = await input.row(sql, lookup);
      if (
        candidate?.status !== 'ready' ||
        typeof candidate.input !== 'string' ||
        typeof candidate.refs !== 'string' ||
        !Number.isSafeInteger(candidate.revision) ||
        Number(candidate.revision) < 0
      )
        return;
      snapshot = candidate;
      epoch = current;
    });
    if (!snapshot || epoch === undefined) return undefined;
    let identity: WorkflowOperationIdentity;
    try {
      const refs: unknown = JSON.parse(String(snapshot.refs));
      if (
        !Array.isArray(refs) ||
        refs.some(ref => !validReference(ref)) ||
        stableJson(refs) !== snapshot.refs
      )
        return undefined;
      identity = {
        operationId,
        input: String(snapshot.input),
        evidenceReferences: refs,
      };
    } catch {
      return undefined;
    }
    // This callback checks the exact immutable live invocation and current source revisions;
    // it is outside the transaction because it may itself read the protected database.
    if ((await input.valid(identity)) !== epoch) return undefined;
    let result: WorkflowOperationIdentity | undefined;
    await input.database.transaction(async sql => {
      if (!(await input.live(sql, epoch!))) return;
      const current = await input.row(sql, identity);
      if (
        current?.status !== 'ready' ||
        current.revision !== snapshot!.revision ||
        current.input !== snapshot!.input ||
        current.refs !== snapshot!.refs ||
        stableJson(identity.evidenceReferences) !== snapshot!.refs ||
        identity.input !== snapshot!.input
      )
        return;
      result = identity;
    });
    return result;
  };
}
