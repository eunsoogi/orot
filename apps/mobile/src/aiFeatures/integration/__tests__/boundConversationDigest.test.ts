import * as evidence from '../evidenceUtils';
import type { SqlResult } from '@orot/storage';
import {
  boundConversationDigestFixture as fixture,
  gate,
} from '../testSupport/boundConversationDigestFixture';

test('strictly reads all 48 aliases twice, but hashes each adjacent exact snapshot once per fence', async () => {
  const f = await fixture();
  const refs = Array.from({ length: 48 }, () => f.bind(f.parent));
  const roots = f.observeRoots(new Set([f.parent.id]));
  const canonicalize = jest.spyOn(evidence, 'fingerprint');
  try {
    const result = await f.capture(refs);
    expect(result.mapping.size).toBe(48);
    expect(result.sources).toHaveLength(1);
    expect(roots.counts).toHaveLength(96);
    expect(
      canonicalize.mock.calls.filter(
        ([value]) =>
          value &&
          typeof value === 'object' &&
          'id' in value &&
          value.id === f.parent.id,
      ),
    ).toHaveLength(2);
  } finally {
    canonicalize.mockRestore();
    roots.restore();
    f.close();
  }
});

test.each(['delete', 'change'] as const)(
  'committed parent %s after the first final SELECT on the same connection still rejects',
  async mutation => {
    const f = await fixture();
    const refs = [f.bind(f.parent), f.bind(f.parent)];
    const entered = gate();
    const resume = gate();
    const roots = f.observeRoots(
      new Set([f.parent.id]),
      async (_id, ordinal, returned) => {
        if (ordinal !== 3 || returned !== 1) return;
        entered.release();
        await resume.wait;
      },
    );
    const pending = f.capture(refs);
    try {
      await Promise.race([entered.wait, pending]);
      const sql =
        mutation === 'delete'
          ? 'DELETE FROM conversation_artifacts WHERE id = ?'
          : "UPDATE conversation_artifacts SET result_json = json_set(result_json, '$.answer', 'Synthetic changed answer') WHERE id = ?";
      const removed = await f.database.execute(sql, [f.parent.id]);
      expect(removed.rowsAffected).toBe(1);
      resume.release();
      await expect(pending).rejects.toThrow();
      expect(roots.counts).toHaveLength(4);
      expect(
        (
          await f.database.execute(
            'SELECT id FROM conversation_artifacts WHERE id = ?',
            [f.parent.id],
          )
        ).rows,
      ).toHaveLength(mutation === 'delete' ? 0 : 1);
    } finally {
      resume.release();
      await pending.catch(() => {});
      roots.restore();
      f.close();
    }
  },
);

test('keeps alternating payloads distinct, and fails closed when an adjacent alias expects a different revision', async () => {
  const f = await fixture();
  try {
    const second = {
      ...f.parent,
      id: 'other-bound-parent',
      answer: 'Synthetic alternate answer',
    };
    await f.storage.append(second);
    const alternate = (await f.storage.read(second.id))!;
    const refs = [
      f.bind(f.parent),
      f.bind(alternate),
      f.bind(f.parent),
      f.bind(alternate),
    ];
    const rejected = [f.bind(f.parent), f.bind(f.parent, 'wrong revision')];
    const roots = f.observeRoots(new Set([f.parent.id, alternate.id]));
    const canonicalize = jest.spyOn(evidence, 'fingerprint');
    try {
      expect((await f.capture(refs)).mapping.size).toBe(4);
      expect(roots.counts).toHaveLength(8);
      expect(
        canonicalize.mock.calls.filter(
          ([value]) =>
            value &&
            typeof value === 'object' &&
            'id' in value &&
            (value.id === f.parent.id || value.id === alternate.id),
        ),
      ).toHaveLength(8);
      roots.counts.length = 0;
      await expect(f.capture(rejected)).rejects.toThrow();
      expect(roots.counts).toHaveLength(2);
    } finally {
      canonicalize.mockRestore();
      roots.restore();
    }
  } finally {
    f.close();
  }
});

test('all strict SQL settles before ordered digest errors; malformed rows stop comparison', async () => {
  const f = await fixture();
  const second = { ...f.parent, id: 'second-error-parent' };
  await f.storage.append(second);
  const alternate = (await f.storage.read(second.id))!;
  const refs = [f.bind(f.parent), f.bind(alternate)];
  let laterSqlFails = true;
  const roots = f.observeRoots(
    new Set([f.parent.id, alternate.id]),
    async id => {
      if (laterSqlFails && id === alternate.id)
        throw new Error('Synthetic SQL failure');
    },
  );
  const realFingerprint = evidence.fingerprint;
  const attempts: number[] = [];
  const canonicalize = jest
    .spyOn(evidence, 'fingerprint')
    .mockImplementation(value => {
      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        value.id === f.parent.id
      )
        attempts.push(roots.counts.length);
      return realFingerprint(value);
    });
  try {
    const { rows } = await f.database.execute(
      'SELECT result_json FROM conversation_artifacts WHERE id = ?',
      [f.parent.id],
    );
    const original = rows[0]?.result_json;
    if (typeof original !== 'string')
      throw new Error('Missing synthetic parent');
    // JSON parsing accepts this depth; the actual recursive digest fails.
    const extra = '['.repeat(14000) + '0' + ']'.repeat(14000);
    const deep = original.slice(0, -1) + ',"synthetic_extra":' + extra + '}';
    expect(() => realFingerprint(JSON.parse(deep))).toThrow(RangeError);
    await f.database.execute(
      'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
      [deep, f.parent.id],
    );
    await expect(f.capture(refs)).rejects.toThrow();
    expect(roots.counts).toHaveLength(2);
    expect(attempts).toEqual([]);
    roots.counts.length = 0;
    laterSqlFails = false;
    await expect(f.capture(refs)).rejects.toThrow();
    expect(roots.counts).toHaveLength(2);
    expect(attempts).toEqual([2]);
    roots.counts.length = 0;
    attempts.length = 0;
    await f.database.execute(
      "UPDATE conversation_artifacts SET result_json = json_set(?, '$.answer', 42) WHERE id = ?",
      [original, f.parent.id],
    );
    await expect(f.capture(refs)).rejects.toThrow();
    expect(roots.counts).toHaveLength(2);
    expect(attempts).toEqual([]);
  } finally {
    canonicalize.mockRestore();
    roots.restore();
    f.close();
  }
});

test('a mutable SQL result cell cannot overwrite the immutable bytes witnessed by decode', async () => {
  const f = await fixture();
  const refs = [f.bind(f.parent), f.bind(f.parent)];
  const { rows } = await f.database.execute(
    'SELECT result_json FROM conversation_artifacts WHERE id = ?',
    [f.parent.id],
  );
  const original = rows[0]?.result_json;
  if (typeof original !== 'string') throw new Error('Missing synthetic parent');
  let secondCell: SqlResult['rows'][number] | undefined;
  let selectCount = 0;
  let restoredCell = false;
  const roots = f.observeRoots(
    new Set([f.parent.id]),
    async (_id, ordinal, _count, row) => {
      if (ordinal === 2) {
        expect(row?.result_json).not.toBe(original);
        secondCell = row;
      }
    },
    async (query, params) => {
      if (
        query.startsWith(
          'SELECT a.id, a.session_id, a.created_at, a.result_json',
        ) &&
        params?.[0] === f.parent.id &&
        ++selectCount === 2
      ) {
        await f.database.execute(
          "UPDATE conversation_artifacts SET result_json = json_set(result_json, '$.answer', 'Synthetic changed snapshot') WHERE id = ?",
          [f.parent.id],
        );
      } else if (secondCell) {
        // At the next lineage SQL the reader has already decoded the changed row.
        secondCell.result_json = original;
        secondCell = undefined;
        restoredCell = true;
      }
    },
  );
  try {
    await expect(f.capture(refs)).rejects.toThrow();
    expect(restoredCell).toBe(true);
    expect(roots.counts).toHaveLength(2);
  } finally {
    roots.restore();
    f.close();
  }
});
