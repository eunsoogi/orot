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
import { acquireIndependentReadEpoch } from './protectedReadEpoch';
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
  let active = true;
  const current = () => active && protection.currentPhase?.() === 'active';
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
      active = false;
  });
  try {
    if (!current() || !(await confirm()) || !current()) return null;
    // A cached encrypted handle alone does not prove the device can currently reveal data.
    const database = await openLocalAgentMemoryDatabase();
    if (!current()) return null;
    const epoch = acquireIndependentReadEpoch(database);
    if (!epoch) return null;
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
  if (
    !snapshot ||
    snapshot.id !== id ||
    snapshot.kind !== 'reviewed_interaction' ||
    snapshot.provenance.reviewState !== 'human_reviewed' ||
    !snapshot.provenance.sourceIds.length ||
    snapshot.provenance.sourceIds.some(value => value !== value.trim()) ||
    !row.some(value => value.revision === reviewedMemoryRevision(record)) ||
    !(await ownsHistoricalVisitMemory(tx, snapshot))
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
