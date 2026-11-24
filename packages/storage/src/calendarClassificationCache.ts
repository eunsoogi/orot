import type { SqlDatabase, SqlExecutor } from './sql';

const versionedHash = /^v1:[0-9a-f]{64}$/u;
export const cacheClasses = ['medical', 'non_medical', 'uncertain'] as const;
export const cacheUncertainties = ['low', 'medium', 'high'] as const;

export type CalendarClassificationWitness = Readonly<{
  occurrence: string;
  revision: string;
}>;

export type CachedCalendarDecision = Readonly<
  CalendarClassificationWitness & {
    classification: (typeof cacheClasses)[number];
    uncertainty: (typeof cacheUncertainties)[number];
  }
>;

export interface CalendarClassificationCache {
  read(
    keys: readonly string[],
    signal: AbortSignal,
  ): Promise<{
    readonly generation: number;
    readonly rows: readonly CachedCalendarDecision[];
  }>;
  startIfCurrent<T>(generation: number, signal: AbortSignal, start: () => T): Promise<{ value: T }>;
  commit(
    generation: number,
    rows: readonly CachedCalendarDecision[],
    pruneTo: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<void>;
}

function current(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Calendar classification retired.');
}

export function isCalendarClassificationWitness(
  input: unknown,
): input is CalendarClassificationWitness {
  if (!input || typeof input !== 'object') return false;
  const { occurrence, revision } = input as Partial<CalendarClassificationWitness>;
  return (
    typeof occurrence === 'string' &&
    typeof revision === 'string' &&
    versionedHash.test(occurrence) &&
    versionedHash.test(revision)
  );
}

/** Store only exact durable verdicts plus opaque Calendar ownership/revision witnesses, never an event title. */
export async function createCalendarClassificationCacheTable(executor: SqlExecutor) {
  await executor.execute(`CREATE TABLE IF NOT EXISTS calendar_classification_cache (
    occurrence TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    classification TEXT NOT NULL CHECK (classification IN ('medical', 'non_medical', 'uncertain')),
    uncertainty TEXT NOT NULL CHECK (uncertainty IN ('low', 'medium', 'high'))
  ) WITHOUT ROWID`);
  await executor.execute(
    'CREATE TABLE IF NOT EXISTS calendar_classification_generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL)',
  );
  await executor.execute('INSERT OR IGNORE INTO calendar_classification_generation VALUES (1, 0)');
}

export async function clearCalendarClassificationCache(executor: SqlExecutor) {
  await executor.execute(
    'UPDATE calendar_classification_generation SET generation = generation + 1 WHERE singleton = 1',
  );
  await executor.execute('DELETE FROM calendar_classification_cache');
}

export function createCalendarClassificationCache(
  database: SqlDatabase,
): CalendarClassificationCache {
  return {
    async read(keys, signal) {
      current(signal);
      const result = await database.execute(
        `SELECT generation, occurrence, revision, classification, uncertainty
           FROM calendar_classification_generation
           LEFT JOIN calendar_classification_cache ON occurrence IN (SELECT value FROM json_each(?))
          WHERE singleton = 1`,
        [JSON.stringify(keys)],
      );
      current(signal);
      const generation = result.rows[0]?.generation;
      if (typeof generation !== 'number' || !Number.isSafeInteger(generation))
        throw new Error('Calendar cache owner is unavailable.');
      const rows = result.rows.flatMap((row) => {
        const { classification, uncertainty } = row;
        if (
          !isCalendarClassificationWitness(row) ||
          !cacheClasses.some((value) => value === classification) ||
          !cacheUncertainties.some((value) => value === uncertainty)
        )
          return [];
        return [
          {
            occurrence: row.occurrence,
            revision: row.revision,
            classification,
            uncertainty,
          } as CachedCalendarDecision,
        ];
      });
      return { generation, rows };
    },
    async startIfCurrent(generation, signal, start) {
      let started!: { value: ReturnType<typeof start> };
      await database.transaction(async (tx) => {
        current(signal);
        await assertOwner(tx, generation);
        current(signal);
        // Linearize admission with clear; this callback starts work only, never waits for the model.
        started = { value: start() };
      });
      return started;
    },
    async commit(generation, rows, pruneTo, signal) {
      await database.transaction(async (tx) => {
        current(signal);
        await assertOwner(tx, generation);
        for (const row of rows) {
          current(signal);
          if (!isCalendarClassificationWitness(row)) throw new Error('Invalid Calendar witness.');
          await tx.execute(
            `INSERT INTO calendar_classification_cache (occurrence, revision, classification, uncertainty)
             VALUES (?, ?, ?, ?) ON CONFLICT(occurrence) DO UPDATE SET
               revision = excluded.revision, classification = excluded.classification, uncertainty = excluded.uncertainty`,
            [row.occurrence, row.revision, row.classification, row.uncertainty],
          );
        }
        if (pruneTo !== undefined) {
          current(signal);
          await tx.execute(
            'DELETE FROM calendar_classification_cache WHERE occurrence NOT IN (SELECT value FROM json_each(?))',
            [JSON.stringify(pruneTo)],
          );
        }
        // Revocation while a queued write awaited must roll back both inserts and pruning.
        current(signal);
      });
    },
  };
}

async function assertOwner(executor: SqlExecutor, generation: number) {
  const owner = await executor.execute(
    'SELECT generation FROM calendar_classification_generation WHERE singleton = 1',
  );
  if (owner.rows[0]?.generation !== generation)
    throw new Error('Calendar cache owner changed.');
}
