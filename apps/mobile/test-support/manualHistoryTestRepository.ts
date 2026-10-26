import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
  ManualHistoryScreenRepository,
} from '../src/manualHistory/types';

export function createManualHistoryTestRepository(): ManualHistoryScreenRepository {
  let nextId = 1;
  const entries: ManualHistoryScreenRecord[] = [];

  function activeEntries() {
    return entries.filter(
      entry => !entries.some(candidate => candidate.supersedesId === entry.id),
    );
  }

  function createRecord(
    input: ManualHistoryScreenDraft,
    supersedesId?: string,
  ) {
    const sequence = nextId++;
    const entry: ManualHistoryScreenRecord = {
      id: 'synthetic-entry-' + sequence,
      ...input,
      recordedAt:
        sequence === 1 ? '2026-09-15T10:20:00Z' : '2026-09-16T11:20:00Z',
      provenance: { origin: 'user_reported' },
      reviewState: { status: 'unreviewed' },
      ...(supersedesId ? { supersedesId } : {}),
    };
    entries.push(entry);
    return entry;
  }

  function lineage(id: string): ManualHistoryScreenRecord[] {
    let current = entries.find(entry => entry.id === id);
    if (!current) return [];
    while (current?.supersedesId) {
      current = entries.find(entry => entry.id === current?.supersedesId);
    }
    const result: ManualHistoryScreenRecord[] = [];
    while (current) {
      result.push(current);
      current = entries.find(entry => entry.supersedesId === current?.id);
    }
    return result;
  }

  return {
    async list() {
      return activeEntries();
    },
    async create(input) {
      return createRecord(input);
    },
    async correct(id, input) {
      return createRecord(input, id);
    },
    async history(id) {
      return lineage(id);
    },
    async delete(id) {
      const versions = lineage(id);
      if (versions.length === 0) return false;
      const removedIds = new Set(versions.map(entry => entry.id));
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (removedIds.has(entries[index]!.id)) entries.splice(index, 1);
      }
      return true;
    },
  };
}
