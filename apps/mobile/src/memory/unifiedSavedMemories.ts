import type { AgentMemoryHit } from '@orot/agent-memory';
import type { ManualHistoryScreenRecord } from '../manualHistory/types';

export type AgentSavedMemory = Omit<AgentMemoryHit, 'score'>;
export interface HistorySavedMemory {
  readonly sourceKind: 'manual_history';
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
  readonly record: ManualHistoryScreenRecord;
}
export type SavedMemory = AgentSavedMemory | HistorySavedMemory;
export function isHistoryMemory(row: SavedMemory): row is HistorySavedMemory {
  return 'sourceKind' in row && row.sourceKind === 'manual_history';
}

/** Keep original identities editable; suppress only single-source projections of present originals. */
export function unifySavedMemories(
  memories: AgentSavedMemory[],
  history: ManualHistoryScreenRecord[],
): SavedMemory[] {
  const ids = new Set(history.map(row => row.id));
  return [
    ...memories.filter(row => {
      const refs = row.provenance.sourceReferences;
      return !(
        refs?.length === 1 &&
        refs[0].kind === 'manual_history' &&
        ids.has(refs[0].id) &&
        row.provenance.sourceIds.length === 1 &&
        row.provenance.sourceIds[0] === refs[0].id
      );
    }),
    ...history.map(record => ({
      sourceKind: 'manual_history' as const,
      // Namespaced UI identity does not alter the persisted original or source references.
      id: 'manual-history:' + record.id,
      text: record.title + '\n' + record.details,
      createdAt: Date.parse(record.recordedAt),
      record,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** A protected local read only: no projection migration, provider dispatch or record rewrite. */
export async function loadUnifiedLocalMemories(): Promise<SavedMemory[]> {
  const [{ loadSavedLocalMemories }, { openLocalManualHistoryRepository }] =
    await Promise.all([
      import('./savedLocalMemories'),
      import('../manualHistory/localRepository'),
    ]);
  const [memories, repository] = await Promise.all([
    loadSavedLocalMemories(),
    openLocalManualHistoryRepository(),
  ]);
  return unifySavedMemories(memories, await repository.list());
}
