import {
  ManualHistoryQuerySchema,
  correctManualHistoryEntry,
  createManualHistoryEntry,
  toManualHistoryEvidence,
} from '@orot/domain';
import type {
  ManualHistoryCorrectionInput,
  ManualHistoryCreateInput,
  ManualHistoryEntry,
  ManualHistoryEvidence,
  ManualHistoryQuery,
  ParsedManualHistoryQuery,
} from '@orot/domain';
import {
  decodeManualHistoryRow,
  insertManualHistoryEntry,
  readManualHistoryEntry,
  readSuccessor,
} from './manualHistoryPersistence';
import type { SqlDatabase, SqlValue } from './sql';

export type NewManualHistoryEntry = Omit<
  ManualHistoryCreateInput,
  'id' | 'recordedAt' | 'ingestedAt' | 'supersedesId' | 'correctionNote'
>;

export interface ManualHistoryRepository {
  list(query?: ManualHistoryQuery): Promise<ManualHistoryEntry[]>;
  get(id: string): Promise<ManualHistoryEntry | null>;
  create(input: NewManualHistoryEntry): Promise<ManualHistoryEntry>;
  correct(id: string, input: ManualHistoryCorrectionInput): Promise<ManualHistoryEntry>;
  history(id: string): Promise<ManualHistoryEntry[]>;
  listEvidence(query?: Omit<ManualHistoryQuery, 'includeSuperseded'>): Promise<ManualHistoryEvidence[]>;
  getEvidence(id: string): Promise<ManualHistoryEvidence | null>;
}

export interface ManualHistoryRepositoryOptions {
  clock?: () => string;
  createId?: () => string;
}

function newManualHistoryId(): string {
  return 'manual-history-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function listSql(query: ParsedManualHistoryQuery): { sql: string; parameters: SqlValue[] } {
  const conditions = ['1 = 1'];
  const parameters: SqlValue[] = [];
  if (!query.includeSuperseded) {
    conditions.push(
      'NOT EXISTS (SELECT 1 FROM manual_history_entries AS successor ' +
        'WHERE successor.supersedes_id = entry.id)',
    );
  }
  if (query.kind) {
    conditions.push('entry.entry_kind = ?');
    parameters.push(query.kind);
  }
  if (query.dateStatus) {
    conditions.push('entry.date_known = ?');
    parameters.push(query.dateStatus === 'known' ? 1 : 0);
  }
  if (query.effectiveDateFrom) {
    conditions.push('entry.effective_date >= ?');
    parameters.push(query.effectiveDateFrom);
  }
  if (query.effectiveDateThrough) {
    conditions.push('entry.effective_date <= ?');
    parameters.push(query.effectiveDateThrough);
  }
  if (query.search) {
    const escapedSearch = query.search.toLowerCase().replace(/[!%_]/g, '!$&');
    const search = '%' + escapedSearch + '%';
    conditions.push(
      "(lower(json_extract(entry.payload_json, '$.title')) LIKE ? ESCAPE '!' OR " +
        "lower(json_extract(entry.payload_json, '$.details')) LIKE ? ESCAPE '!')",
    );
    parameters.push(search, search);
  }
  return {
    sql:
      'SELECT entry.id, entry.entry_kind, entry.effective_date, entry.date_known, ' +
      'entry.recorded_at, entry.ingested_at, entry.supersedes_id, entry.payload_json ' +
      'FROM manual_history_entries AS entry WHERE ' + conditions.join(' AND ') +
      ' ORDER BY entry.date_known DESC, entry.effective_date DESC, entry.recorded_at DESC, entry.id ASC',
    parameters,
  };
}

export function createManualHistoryRepository(
  database: SqlDatabase,
  options: ManualHistoryRepositoryOptions = {},
): ManualHistoryRepository {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId = options.createId ?? newManualHistoryId;

  async function list(query: ManualHistoryQuery = {}): Promise<ManualHistoryEntry[]> {
    const parsed = ManualHistoryQuerySchema.parse(query);
    const { sql, parameters } = listSql(parsed);
    const result = await database.execute(sql, parameters);
    return result.rows.map(decodeManualHistoryRow);
  }

  async function history(id: string): Promise<ManualHistoryEntry[]> {
    let result: ManualHistoryEntry[] = [];
    await database.transaction(async transaction => {
      let current = await readManualHistoryEntry(transaction, id);
      if (!current) throw new Error('Manual history entry not found.');
      const ancestors = new Set<string>([current.id]);
      while (current.supersedesId) {
        if (ancestors.has(current.supersedesId)) {
          throw new Error('Manual history correction lineage is invalid.');
        }
        ancestors.add(current.supersedesId);
        const predecessor = await readManualHistoryEntry(transaction, current.supersedesId);
        if (!predecessor) throw new Error('Manual history correction lineage is invalid.');
        current = predecessor;
      }

      const versions: ManualHistoryEntry[] = [];
      const descendants = new Set<string>();
      while (true) {
        if (descendants.has(current.id)) {
          throw new Error('Manual history correction lineage is invalid.');
        }
        descendants.add(current.id);
        versions.push(current);
        const successor = await readSuccessor(transaction, current.id);
        if (!successor) break;
        current = successor;
      }
      result = versions;
    });
    return result;
  }

  return {
    list,
    get: id => readManualHistoryEntry(database, id),
    async create(input) {
      const recordedAt = clock();
      const entry = createManualHistoryEntry({
        ...input,
        id: createId(),
        recordedAt,
        ingestedAt: recordedAt,
      });
      await database.transaction(transaction => insertManualHistoryEntry(transaction, entry));
      return entry;
    },
    async correct(id, input) {
      let corrected!: ManualHistoryEntry;
      await database.transaction(async transaction => {
        const previous = await readManualHistoryEntry(transaction, id);
        if (!previous) throw new Error('Manual history entry not found.');
        if (await readSuccessor(transaction, id)) {
          throw new Error('Only the current manual history entry can be corrected.');
        }
        const recordedAt = clock();
        corrected = correctManualHistoryEntry(previous, input, {
          id: createId(),
          recordedAt,
          ingestedAt: recordedAt,
        });
        await insertManualHistoryEntry(transaction, corrected);
      });
      return corrected;
    },
    history,
    async listEvidence(query = {}) {
      const entries = await list({ ...query, includeSuperseded: false });
      return entries.map(toManualHistoryEvidence);
    },
    async getEvidence(id) {
      let evidence: ManualHistoryEvidence | null = null;
      await database.transaction(async transaction => {
        const entry = await readManualHistoryEntry(transaction, id);
        if (entry && !(await readSuccessor(transaction, id))) {
          evidence = toManualHistoryEvidence(entry);
        }
      });
      return evidence;
    },
  };
}
