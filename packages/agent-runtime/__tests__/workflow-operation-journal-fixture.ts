import type {
  WorkflowOperationIdentity,
  WorkflowOperationJournal,
  WorkflowOperationRecord,
} from '../src';

/** Synthetic in-memory journal proves runtime call ordering, not production SQLite durability. */
export function operationJournalFixture() {
  const records = new Map<
    string,
    {
      input: string;
      refs: WorkflowOperationIdentity['evidenceReferences'];
      state: WorkflowOperationRecord;
    }
  >();
  const identityMatches = (id: WorkflowOperationIdentity) =>
    records.get(id.operationId)?.input === id.input;
  const journal: WorkflowOperationJournal = {
    async loadPrepared(operationId) {
      const row = records.get(operationId);
      return row?.state.status === 'ready'
        ? { operationId, input: row.input, evidenceReferences: row.refs }
        : undefined;
    },
    async loadOrCreate(id) {
      if (!records.has(id.operationId))
        records.set(id.operationId, {
          input: id.input,
          refs: id.evidenceReferences,
          state: { status: 'ready', revision: 0 },
        });
      return identityMatches(id) ? records.get(id.operationId)!.state : { status: 'invalidated' };
    },
    async begin(id) {
      const record = records.get(id.operationId);
      if (
        !identityMatches(id) ||
        record?.state.status !== 'ready' ||
        record.state.revision !== id.revision
      )
        return { status: 'blocked' };
      record.state = { status: 'pending' };
      return { status: 'claimed', claim: id.operationId };
    },
    async complete(id) {
      const record = records.get(id.operationId);
      if (!identityMatches(id) || record?.state.status !== 'pending' || id.claim !== id.operationId)
        return false;
      record.state = { status: 'completed', result: id.result };
      return true;
    },
  };
  return { journal, records };
}
