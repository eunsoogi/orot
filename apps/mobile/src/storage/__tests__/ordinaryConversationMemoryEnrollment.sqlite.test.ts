import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createOrdinaryConversationMemoryEnrollmentStore,
  matchesOrdinaryConversationMemoryEnrollment,
  readOrdinaryConversationMemoryEnrollment,
} from '../ordinaryConversationMemoryEnrollment';

// The mobile TS config has no Node globals beyond the existing typed test require.
const { copyFileSync, mkdtempSync, rmSync } = require('node:fs') as {
  copyFileSync(from: string, to: string): void;
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

const stillCurrent = () => true;
const one = 'a'.repeat(64);
const two = 'b'.repeat(64);

test('defaults to off and prevents a revoked generation from becoming current again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-memory-enrollment-'));
  const path = join(directory, 'synthetic.sqlite');
  const first = openSqliteTestDatabase(path);
  const second = openSqliteTestDatabase(path);
  try {
    const a = createOrdinaryConversationMemoryEnrollmentStore(first.database);
    const b = createOrdinaryConversationMemoryEnrollmentStore(second.database);
    const original = await a.read();
    expect(original).toEqual({
      enabled: false,
      generation: 0,
      deviceEpoch: null,
    });
    const enabled = (await a.replace(original, one, stillCurrent))!;
    expect(enabled).toEqual({ enabled: true, generation: 1, deviceEpoch: one });
    expect(await b.read()).toEqual(enabled);
    expect(await b.replace(enabled, one, stillCurrent)).toEqual(enabled);
    const revoked = (await b.replace(enabled, null, stillCurrent))!;
    expect(revoked).toEqual({
      enabled: false,
      generation: 2,
      deviceEpoch: null,
    });
    const reopened = (await b.replace(revoked, two, stillCurrent))!;
    expect(reopened).toEqual({
      enabled: true,
      generation: 3,
      deviceEpoch: two,
    });
    expect(await a.replace(enabled, null, stillCurrent)).toBeUndefined();
    // The same protected transaction that will authorize a note sees the new generation.
    await first.database.transaction(async tx => {
      expect(await readOrdinaryConversationMemoryEnrollment(tx)).toEqual(
        reopened,
      );
    });
  } finally {
    first.close();
    second.close();
    // This directory was created above and contains only this test's SQLite fixture.
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rolls back the actual SQLite INSERT when ownership is lost before the final commit', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  let inserted!: () => void;
  let release!: () => void;
  const insertion = new Promise<void>(resolve => {
    inserted = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const database: SqlDatabase = {
    ...sqlite.database,
    transaction: operation =>
      sqlite.database.transaction(tx =>
        operation({
          ...tx,
          async execute(sql, parameters) {
            const result = await tx.execute(sql, parameters);
            if (sql.startsWith('INSERT')) {
              inserted();
              await held;
            }
            return result;
          },
        }),
      ),
  };
  let pending:
    | ReturnType<
        ReturnType<
          typeof createOrdinaryConversationMemoryEnrollmentStore
        >['replace']
      >
    | undefined;
  try {
    const store = createOrdinaryConversationMemoryEnrollmentStore(database);
    const original = await store.read();
    let owned = true;
    pending = store.replace(original, one, () => owned);
    await Promise.race([insertion, pending]);
    owned = false;
    release();
    await expect(pending).rejects.toThrow('enrollment owner changed');
    expect(await store.read()).toEqual(original);
  } finally {
    release();
    await pending?.catch(() => undefined);
    sqlite.close();
  }
});

test('a damaged on-disk generation is unreadable and cannot enable capture', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  try {
    const store = createOrdinaryConversationMemoryEnrollmentStore(
      sqlite.database,
    );
    const original = await store.read();
    await sqlite.database.execute(
      'INSERT INTO ordinary_conversation_memory_enrollment VALUES (1, 1, 1.5, ?)',
      [one],
    );
    await expect(store.read()).rejects.toThrow('enrollment is unreadable');
    await expect(store.replace(original, one, stillCurrent)).rejects.toThrow(
      'enrollment is unreadable',
    );
  } finally {
    sqlite.close();
  }
});

test('a restored SQLite receipt cannot resume capture after missing authority or reenrollment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-restored-enrollment-'));
  const livePath = join(directory, 'synthetic.sqlite');
  const restorePath = join(directory, 'snapshot.sqlite');
  try {
    // Closing the source flushes the exact on-disk row before making the snapshot.
    const source = openSqliteTestDatabase(livePath);
    try {
      const store = createOrdinaryConversationMemoryEnrollmentStore(
        source.database,
      );
      await store.replace(await store.read(), one, stillCurrent);
    } finally {
      source.close();
    }
    copyFileSync(livePath, restorePath);
    const snapshot = openSqliteTestDatabase(restorePath);
    try {
      const store = createOrdinaryConversationMemoryEnrollmentStore(
        snapshot.database,
      );
      const before = await store.read();
      await snapshot.database.transaction(async tx => {
        const restored = await readOrdinaryConversationMemoryEnrollment(tx);
        expect(matchesOrdinaryConversationMemoryEnrollment(restored, one)).toBe(
          true,
        );
        expect(
          matchesOrdinaryConversationMemoryEnrollment(restored, null),
        ).toBe(false);
        expect(matchesOrdinaryConversationMemoryEnrollment(restored, two)).toBe(
          false,
        );
      });
      const next = (await store.replace(before, two, stillCurrent))!;
      expect(next.generation).toBeGreaterThan(before.generation);
      expect(matchesOrdinaryConversationMemoryEnrollment(next, one)).toBe(
        false,
      );
      expect(matchesOrdinaryConversationMemoryEnrollment(next, two)).toBe(true);
      await expect(store.replace(next, 'old', stillCurrent)).rejects.toThrow(
        'Local memory authority is invalid',
      );
    } finally {
      snapshot.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
