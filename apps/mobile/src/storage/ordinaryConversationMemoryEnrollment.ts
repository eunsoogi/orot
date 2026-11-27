import type { SqlDatabase, SqlExecutor } from '@orot/storage';

export type LocalConversationMemoryScope =
  'reply-preferences' | 'authored-routine' | 'authored-note';

/** These independently disclosed grants never share a persisted row. */
function enrollmentTable(scope: LocalConversationMemoryScope) {
  switch (scope) {
    case 'reply-preferences':
      return 'ordinary_conversation_memory_enrollment';
    case 'authored-routine':
      return 'authored_routine_memory_enrollment';
    case 'authored-note':
      return 'authored_note_memory_enrollment';
  }
}

export interface OrdinaryConversationMemoryEnrollment {
  readonly enabled: boolean;
  readonly generation: number;
  readonly deviceEpoch: string | null;
}

const INITIAL: OrdinaryConversationMemoryEnrollment = Object.freeze({
  enabled: false,
  generation: 0,
  deviceEpoch: null,
});

const isDeviceEpoch = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** A backed-up database is not an authority to resume automatic capture.
 * Require the exact random consent epoch read from the separate device-only owner. */
export function matchesOrdinaryConversationMemoryEnrollment(
  enrollment: OrdinaryConversationMemoryEnrollment,
  deviceEpoch: unknown,
): boolean {
  return (
    isDeviceEpoch(deviceEpoch) &&
    enrollment.enabled &&
    enrollment.deviceEpoch === deviceEpoch
  );
}

/** Reads within the caller's protected transaction, so generation can guard
 * the eventual note write in the same transaction. No row is an opt-out. */
export async function readOrdinaryConversationMemoryEnrollment(
  sql: SqlExecutor,
  scope: LocalConversationMemoryScope = 'reply-preferences',
): Promise<OrdinaryConversationMemoryEnrollment> {
  const { rows } = await sql.execute(
    `SELECT enabled, generation, device_epoch FROM ${enrollmentTable(scope)} WHERE singleton = 1`,
  );
  if (rows.length === 0) return INITIAL;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    (row.enabled !== 0 && row.enabled !== 1) ||
    typeof row.generation !== 'number' ||
    !Number.isSafeInteger(row.generation) ||
    row.generation < 1 ||
    (row.enabled === 1
      ? !isDeviceEpoch(row.device_epoch)
      : row.device_epoch !== null)
  ) {
    // A missing or damaged authority cannot silently enable automated writes.
    throw new Error('Local memory enrollment is unreadable.');
  }
  return {
    enabled: row.enabled === 1,
    generation: row.generation,
    deviceEpoch: row.device_epoch as string | null,
  };
}

/** Stores only a device-local decision, never any conversation content. A
 * disable followed by enable cannot reauthorize work from an older generation. */
export function createOrdinaryConversationMemoryEnrollmentStore(
  database: SqlDatabase,
  scope: LocalConversationMemoryScope = 'reply-preferences',
) {
  const table = enrollmentTable(scope);
  let ready: Promise<unknown> | undefined;
  const prepare = () =>
    (ready ??= database
      .execute(
        `CREATE TABLE IF NOT EXISTS ${table} (` +
          'singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1), ' +
          'enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), ' +
          'generation INTEGER NOT NULL CHECK(generation > 0), ' +
          'device_epoch TEXT, CHECK((enabled = 1 AND device_epoch IS NOT NULL) OR ' +
          '(enabled = 0 AND device_epoch IS NULL)))',
      )
      .catch(error => {
        ready = undefined;
        throw error;
      }));
  return {
    async read() {
      await prepare();
      return readOrdinaryConversationMemoryEnrollment(database, scope);
    },
    async replace(
      expected: OrdinaryConversationMemoryEnrollment,
      deviceEpoch: string | null,
      isCurrent: () => boolean,
    ): Promise<OrdinaryConversationMemoryEnrollment | undefined> {
      if (deviceEpoch !== null && !isDeviceEpoch(deviceEpoch))
        throw new Error('Local memory authority is invalid.');
      const enabled = deviceEpoch !== null;
      await prepare();
      let committed: OrdinaryConversationMemoryEnrollment | undefined;
      await database.transaction(async tx => {
        if (!isCurrent()) return;
        const current = await readOrdinaryConversationMemoryEnrollment(
          tx,
          scope,
        );
        if (
          current.enabled !== expected.enabled ||
          current.generation !== expected.generation ||
          current.deviceEpoch !== expected.deviceEpoch ||
          !isCurrent()
        ) {
          return;
        }
        if (deviceEpoch === current.deviceEpoch) {
          committed = current;
          return;
        }
        const generation = current.generation + 1;
        if (!Number.isSafeInteger(generation))
          throw new Error('Local memory enrollment is exhausted.');
        await tx.execute(
          `INSERT INTO ${table} (singleton, enabled, generation, device_epoch) ` +
            'VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET ' +
            'enabled = excluded.enabled, generation = excluded.generation, device_epoch = excluded.device_epoch',
          [enabled ? 1 : 0, generation, deviceEpoch],
        );
        if (!isCurrent())
          throw new Error('Local memory enrollment owner changed.');
        // The current decision and commit must share one JS continuation.
        tx.commit();
        committed = { enabled, generation, deviceEpoch };
      });
      return committed;
    },
  };
}
