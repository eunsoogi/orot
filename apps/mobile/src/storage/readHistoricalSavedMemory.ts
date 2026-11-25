import { projectDefaultSavedMemory } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import {
  referencesDeletedSymptom,
  deletedSymptomIds,
} from './agentMemorySymptomQuarantine';
import { reviewedMemoryRevision } from './agentMemoryPeriodAttestation';
import {
  decodeAgentMemoryRecord,
  listSupersededTranscriptRevisionIds,
} from './agentMemoryStorageRecords';
import { openLocalAgentMemoryDatabase } from './secureDatabase';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlement,
} from './protectedReadEpoch';
import { hasHistoricalMemoryRevocation } from './historicalMemoryRevocation';
import { ownsHistoricalVisitMemory } from './historicalVisitMemoryAuthority';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';

type HistoricalMemory = {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
};

/** Only the selected detail can request this exact, already-retained local snapshot.
 * Do not return provenance, vectors, or a current-evidence capability to the UI. */
export async function readHistoricalSavedMemory(
  id: string,
): Promise<HistoricalMemory | null> {
  if (!id || id !== id.trim()) return null;
  const protection = conversationExecutionNative();
  if (!protection?.bridgeAvailable) return null;
  const lifetime = new AbortController();
  const current = () =>
    !lifetime.signal.aborted && protection.currentPhase?.() === 'active';
  const confirm = async () => {
    try {
      return (await protection.protectedDataAvailable()) === true;
    } catch {
      return false;
    }
  };
  const unsubscribe = protection.subscribe(event => {
    if (
      event.kind === 'phase' ||
      (event.kind === 'protectedData' && !event.available)
    )
      lifetime.abort();
  });
  try {
    if (!current() || !(await confirm()) || !current()) return null;
    // A cached encrypted handle alone does not prove the device can currently reveal data.
    const database = await openLocalAgentMemoryDatabase();
    if (!current()) return null;
    let epoch = acquireIndependentReadEpoch(database);
    if (!epoch) {
      // A legitimate write on this owner can delay the initial witness. Only
      // retry admission, not a failed historical proof or a selected stale row.
      const budget = 2_500;
      const deadline = performance.now() + budget;
      if (
        !(await awaitIndependentReadSettlement(
          database,
          budget,
          lifetime.signal,
        )) ||
        !current() ||
        !(await confirm()) ||
        !current() ||
        (await openLocalAgentMemoryDatabase()) !== database ||
        !current() ||
        performance.now() >= deadline
      )
        return null;
      epoch = acquireIndependentReadEpoch(database);
      if (!epoch) return null;
    }
    try {
      let result: HistoricalMemory | null = null;
      await database.transaction(async tx => {
        result = await readOwnerSnapshot(tx, id);
      });
      if (!result || !current() || !epoch.current() || !(await confirm()))
        return null;
      if (!current() || !epoch.current()) return null;
      const currentOwner = await openLocalAgentMemoryDatabase();
      return database === currentOwner && current() && epoch.current()
        ? result
        : null;
    } finally {
      epoch.dispose();
    }
  } finally {
    lifetime.abort();
    unsubscribe();
  }
}

async function readOwnerSnapshot(
  tx: SqlExecutor,
  id: string,
): Promise<HistoricalMemory | null> {
  const row = (
    await tx.execute(
      'SELECT m.record_json, q.revision FROM agent_memory_records m JOIN memory_parent_quarantine q ON q.memory_id=m.id WHERE m.id=?',
      [id],
    )
  ).rows;
  if (!row.length) return null;
  const record = decodeAgentMemoryRecord(row[0]?.record_json);
  const snapshot = projectDefaultSavedMemory(record);
  const revision = reviewedMemoryRevision(record);
  if (
    !snapshot ||
    snapshot.id !== id ||
    snapshot.kind !== 'reviewed_interaction' ||
    snapshot.provenance.reviewState !== 'human_reviewed' ||
    !snapshot.provenance.sourceIds.length ||
    snapshot.provenance.sourceIds.some(value => value !== value.trim()) ||
    !row.some(value => value.revision === revision) ||
    !(await ownsHistoricalVisitMemory(tx, snapshot, revision))
  )
    return null;
  const sources = [...snapshot.provenance.sourceIds];
  const superseded = await listSupersededTranscriptRevisionIds(tx);
  if (
    superseded.has(id) ||
    sources.some(source => superseded.has(source)) ||
    referencesDeletedSymptom(record, await deletedSymptomIds(tx)) ||
    (await hasHistoricalMemoryRevocation(tx, id, sources))
  )
    return null;
  return { id, text: snapshot.text, createdAt: snapshot.createdAt };
}
