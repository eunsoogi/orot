import type { SqlDatabase } from '@orot/storage';
import type { RetainedResearch } from '../aiFeatures/integration/retainedResearchSearch';
import { projectResearchArtifact } from './researchArtifactProjection';
import { setupResearchArtifactGuards } from './researchArtifactGuards';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import type { SavedSummarySource } from '../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import {
  existingResearchRequest,
  recordResearchRequest,
} from './researchArtifactRequests';
import {
  setupResearchInputs,
  appendResearchInputs,
  readCurrentResearch,
  rebuildResearchSearch,
  removeResearchArtifact,
  researchGeneration,
} from './researchArtifactInputs';

export interface ResearchArtifact {
  readonly id: number;
  readonly createdAt: string;
  readonly originFeature: string;
  readonly originSession: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly source: RetainedResearch;
  /** Only public-web model output is retained; publication abstracts are not. */
  readonly generatedText: string | null;
  readonly inputSources: readonly SavedSummarySource[];
}

export type ResearchArtifactInput = Omit<
  ResearchArtifact,
  'id' | 'originSession' | 'inputSources'
> & {
  readonly originSession?: string | null;
  readonly inputSources?: readonly SavedSummarySource[];
  readonly requestKey?: string;
};
export type ResearchSessionLease = {
  readonly id: string;
  readonly version: number;
};

/** Stores snapshots in the existing encrypted database, with an epoch fence for whole-data deletion. */
export function createResearchArtifactStorage(database: SqlDatabase) {
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= database
      // Research text and source identities must not spill into plaintext SQLite temporary files.
      .execute('PRAGMA temp_store = MEMORY')
      .then(() =>
        database.transaction(async tx => {
          await tx.execute(
            'CREATE TABLE IF NOT EXISTS research_artifact_generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL)',
          );
          await tx.execute(
            'INSERT OR IGNORE INTO research_artifact_generation VALUES (1, 0)',
          );
          await tx.execute(
            'CREATE TABLE IF NOT EXISTS research_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_json TEXT NOT NULL, search_text TEXT NOT NULL)',
          );
          await tx.execute(
            'CREATE TABLE IF NOT EXISTS research_artifact_invalid (id INTEGER PRIMARY KEY NOT NULL)',
          );
          await tx.execute(
            'CREATE TABLE IF NOT EXISTS research_artifact_requests (request_key TEXT PRIMARY KEY NOT NULL, artifact_id INTEGER NOT NULL)',
          );
          await setupResearchInputs(tx);
          await setupResearchArtifactGuards(tx);
        }),
      )
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async rebuildSearchIndex() {
      await ensure();
      await database.transaction(tx => rebuildResearchSearch(tx, database));
    },
    async revalidatePage(
      items: readonly { id: string; revision: string }[],
      signal: AbortSignal,
    ) {
      await ensure();
      let valid = !signal.aborted;
      await database.transaction(async tx => {
        for (const item of items) {
          const current = await readCurrentResearch(tx, database, item.id);
          if (
            !current ||
            fingerprint(current) !== item.revision ||
            signal.aborted
          ) {
            valid = false;
            break;
          }
        }
      });
      return valid && !signal.aborted;
    },
    async currentGeneration() {
      await ensure();
      return researchGeneration(database);
    },
    remove: (id: number) => removeResearchArtifact(database, ensure, id),
    async append(
      items: readonly ResearchArtifactInput[],
      expectedGeneration: number,
      signal?: AbortSignal,
      session?: ResearchSessionLease,
    ) {
      await ensure();
      const ids: number[] = [];
      await database.transaction(async tx => {
        if (
          signal?.aborted ||
          (await researchGeneration(tx)) !== expectedGeneration
        )
          throw new RetainedSourceInvalidError(
            'Research retention was cancelled or local data was cleared.',
          );
        if (session) {
          const active = await tx.execute(
            'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON s.generation = g.generation WHERE g.singleton = 1 AND s.id = ? AND s.hidden = 0 AND s.version = ?',
            [session.id, session.version],
          );
          if (!active.rows.length)
            throw new RetainedSourceInvalidError(
              'The research source session is unavailable.',
            );
        }
        for (const item of items) {
          if ((item.originSession ?? null) !== (session?.id ?? null))
            throw new Error('Research session identity is invalid.');
          const { source, text } = projectResearchArtifact(item);
          const existing = item.requestKey
            ? await existingResearchRequest(tx, item.requestKey, text)
            : null;
          if (existing !== null) {
            await appendResearchInputs(
              tx,
              database,
              existing,
              item.inputSources ?? [],
            );
            ids.push(existing);
            continue;
          }
          await tx.execute(
            'INSERT INTO research_artifacts (snapshot_json, search_text) VALUES (?, ?)',
            [
              text,
              JSON.stringify({ source, generatedText: item.generatedText })
                .normalize('NFKC')
                .toLowerCase(),
            ],
          );
          const inserted = await tx.execute('SELECT last_insert_rowid() AS id');
          const id = inserted.rows[0]?.id;
          if (typeof id !== 'number' || !Number.isSafeInteger(id))
            throw new Error('Research identity is unavailable.');
          await appendResearchInputs(tx, database, id, item.inputSources ?? []);
          if (item.requestKey)
            await recordResearchRequest(tx, item.requestKey, id);
          ids.push(id);
        }
        if (signal?.aborted)
          throw new Error('Research retention was cancelled.');
      });
      return ids;
    },
    async read(id: number): Promise<ResearchArtifact | null> {
      await ensure();
      let current: ResearchArtifact | null = null;
      await database.transaction(async tx => {
        current = await readCurrentResearch(tx, database, `research-${id}`);
      });
      return current;
    },
    async search(
      query: string,
      cursor: number | null,
      limit: number,
    ): Promise<{
      items: ResearchArtifact[];
      nextCursor: number | null;
      unavailableCount: number;
    }> {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 20 ||
        query.length > 240 ||
        (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1))
      )
        throw new Error('Invalid research search.');
      await ensure();
      const result = await database.execute(
        'SELECT id, snapshot_json FROM research_artifacts WHERE (? IS NULL OR id < ?) AND instr(search_text, ?) > 0 AND NOT EXISTS (SELECT 1 FROM research_artifact_invalid invalid WHERE invalid.id = research_artifacts.id) ORDER BY id DESC LIMIT ?',
        [
          cursor,
          cursor,
          query.trim().normalize('NFKC').toLowerCase(),
          limit + 1,
        ],
      );
      const rows = result.rows.slice(0, limit);
      const decoded: (ResearchArtifact | null)[] = [];
      await database.transaction(async tx => {
        for (const row of rows)
          decoded.push(
            await readCurrentResearch(tx, database, `research-${row.id}`),
          );
      });
      const items = decoded.filter(
        (item): item is ResearchArtifact => item !== null,
      );
      return {
        items,
        unavailableCount: decoded.length - items.length,
        nextCursor:
          result.rows.length > limit ? Number(rows[rows.length - 1]!.id) : null,
      };
    },
  };
}
