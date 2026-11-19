import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import {
  createRecordRepository,
  runMigrations,
  type SqlValue,
} from '@orot/storage';
import { createConversationArtifactStorage } from '../src/storage/conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../src/storage/conversationPeriodRemoval';
import type { SavedPeriodSummarySource } from '../src/diseaseHypotheses/savedSummaries';
import {
  contextWindow,
  seedHealthContextNativeRecords,
} from './healthContextNativeFixtures';

function requireResult(condition: boolean, message: string) {
  if (!condition) throw new Error(`Native period cache: ${message}`);
}

/** Real Hermes/SQLCipher owner calls on a new synthetic file. No app DB/model access.
 * Submitted work followed by close/delete proves settlement across those calls,
 * not that a worker was inside sqlite3_step at interruption time. */
export async function runNativePeriodCacheOperation(identifier: unknown) {
  if (
    typeof identifier !== 'string' ||
    !/^test-period-cache-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Native cache verification requires an isolated UUID');
  if (!isSQLCipher())
    throw new Error('Native cache verification requires SQLCipher');
  const random = new Uint8Array(32);
  globalThis.crypto.getRandomValues(random);
  const settings = {
    name: `${identifier}.db`,
    location: IOS_LIBRARY_PATH,
    encryptionKey: Array.from(random, byte =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  };
  let database = open(settings);
  let closed = false;
  let failed = false;
  try {
    requireResult(
      Boolean(
        (await database.execute('PRAGMA cipher_version')).rows[0]
          ?.cipher_version,
      ),
      'cipher unavailable',
    );
    await runMigrations(database);
    await createConversationArtifactStorage(database).currentGeneration();
    await seedHealthContextNativeRecords(createRecordRepository(database));
    const source: SavedPeriodSummarySource = {
      kind: 'health_context_period',
      revision: 'synthetic',
      deletionGeneration: 0,
      reference: {
        sourceKind: 'personal_record',
        sourceId: 'synthetic',
        sourceRevision: '1',
        evidenceId: 'synthetic',
        evidenceRevision: '1',
        locator: { kind: 'structured_record', recordId: 'synthetic' },
        effectiveTime: contextWindow.fromInclusive,
        reviewState: 'reviewed',
      },
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window: contextWindow,
      },
    };
    const queries: { sql: string; bindings: SqlValue[] }[] = [];
    // Capture production SQL only; all outcomes below use the actual native execute.
    await assertPeriodNotRemoved(
      {
        execute: async (sql, bindings = []) => {
          queries.push({ sql, bindings });
          return { rows: [] };
        },
      },
      source,
    );
    requireResult(queries.length === 4, 'unexpected measurement query count');
    const read = async () => {
      let count = 0;
      for (const query of queries)
        count += (await database.execute(query.sql, query.bindings)).rows
          .length;
      return count;
    };
    requireResult(
      (await read()) === 0 && (await read()) === 0,
      'initial warm reads',
    );
    await database.execute(
      "INSERT INTO agent_memory_removed_sources(source_id) VALUES ('bp-1-0')",
    );
    requireResult((await read()) > 0, 'marker must invalidate warmed result');
    await database.execute('BEGIN');
    await database.execute(
      "DELETE FROM agent_memory_removed_sources WHERE source_id = 'bp-1-0'",
    );
    requireResult((await read()) === 0, 'transaction deletion');
    await database.execute('ROLLBACK');
    requireResult((await read()) > 0, 'rollback restoration');
    await database.execute(
      'ALTER TABLE health_observations ADD COLUMN native_cache_fixture TEXT',
    );
    requireResult((await read()) > 0, 'schema reprepare');
    await database.execute(
      'ALTER TABLE agent_memory_removed_sources RENAME TO fixture_removed_sources',
    );
    let schemaError = false;
    try {
      await read();
    } catch (error) {
      schemaError =
        /no such table: (main\.)?agent_memory_removed_sources/i.test(
          String(error),
        );
    }
    requireResult(schemaError, 'schema failure must reject');
    await database.execute(
      'ALTER TABLE fixture_removed_sources RENAME TO agent_memory_removed_sources',
    );
    requireResult((await read()) > 0, 'recovery after failed prepare');

    const submit = () =>
      Array.from({ length: 8 }, (_, index) => {
        const query = queries[index % queries.length]!;
        // Attach rejection handlers before the synchronous owner close/delete call.
        return database.execute(query.sql, query.bindings).then(
          () => 'resolved',
          error =>
            /interrupted/i.test(String(error))
              ? 'interrupted'
              : 'unexpected-error',
        );
      });
    const pendingClose = submit();
    database.close();
    closed = true;
    const closeSettled = await Promise.all(pendingClose);
    requireResult(
      !closeSettled.includes('unexpected-error'),
      'unexpected close failure',
    );
    let closedRejected = false;
    try {
      await database.execute('SELECT 1');
    } catch (error) {
      closedRejected = /database is closed/i.test(String(error));
    }
    requireResult(
      closedRejected && closeSettled.length === 8,
      'closed owner contract',
    );
    database = open(settings);
    closed = false;
    requireResult((await read()) > 0, 'encrypted reopen');
    const pendingDelete = submit();
    database.delete();
    closed = true;
    const deleteSettled = await Promise.all(pendingDelete);
    requireResult(
      !deleteSettled.includes('unexpected-error'),
      'unexpected delete failure',
    );
    database = open(settings);
    closed = false;
    const tables = await database.execute(
      "SELECT name FROM sqlite_master WHERE name = 'health_observations'",
    );
    requireResult(
      tables.rows.length === 0 && deleteSettled.length === 8,
      'delete must remove only owned file',
    );
    return {
      synthetic: true,
      encrypted: true,
      exactQueryCount: queries.length,
      mutationObserved: true,
      rollbackObserved: true,
      schemaRecovery: true,
      closeSettled: closeSettled.length,
      closeResolved: closeSettled.filter(value => value === 'resolved').length,
      closeInterrupted: closeSettled.filter(value => value === 'interrupted')
        .length,
      closedRejected,
      reopened: true,
      deleteSettled: deleteSettled.length,
      deleteResolved: deleteSettled.filter(value => value === 'resolved')
        .length,
      deleteInterrupted: deleteSettled.filter(value => value === 'interrupted')
        .length,
      ownedFileDeleted: true,
      // No production cache counter or native worker-start barrier exists here.
      cacheHitObserved: false,
      activeInterruptVerified: false,
      ownerInvalidateVerified: false,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (closed) database = open(settings);
      database.delete();
    } catch (cleanupError) {
      // Preserve the primary failure; successful tests still fail on cleanup errors.
      if (!failed) throw cleanupError;
    }
  }
}
