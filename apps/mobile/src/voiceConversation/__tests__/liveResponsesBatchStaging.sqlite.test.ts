import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { createLiveHealthProofLease } from '../../healthEvidence/healthContext/liveHealthProofLease';
import { stageLiveResponsesResults } from '../stageLiveResponsesResult';

test.each([
  'unchanged',
  'edit first',
  'revoke first',
  'retire owner',
  'abort',
] as const)(
  'a real guarded SQLite epoch holds the whole result set during %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      const db = guardedNativeDatabase(f.database);
      await db.execute(
        'CREATE TABLE synthetic_measurements (id TEXT PRIMARY KEY, value INTEGER)',
      );
      await db.execute(
        "INSERT INTO synthetic_measurements VALUES ('first', 61), ('second', 77)",
      );
      let ownerCurrent = true;
      let firstAllowed = true;
      const borrow = createLiveHealthProofLease(
        db,
        owner => owner === db && ownerCurrent,
      );
      const proof = borrow()!;
      expect(proof.current()).toBe(true);
      const controller = new AbortController();
      let arrived!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>(resolve => {
        arrived = resolve;
      });
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const read = async (id: string, approved: number) => {
        const observed = await db.execute(
          'SELECT value FROM synthetic_measurements WHERE id = ?',
          [id],
        );
        return observed.rows[0]?.value === approved;
      };
      const first = jest.fn(() => read('first', 61));
      const second = jest.fn(async () => {
        arrived();
        await held;
        return read('second', 77);
      });
      const handoff = jest.fn(async (_results: readonly unknown[]) => {
        expect(proof.current()).toBe(true);
      });
      const staged = stageLiveResponsesResults({
        signal: controller.signal,
        proof,
        results: [
          {
            id: 'first',
            output: '61',
            current: () => firstAllowed,
            reproveSource: first,
          },
          {
            id: 'second',
            output: '77',
            current: () => true,
            reproveSource: second,
          },
        ],
      });
      const admitting = staged.admit(handoff);
      await waiting;
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(handoff).not.toHaveBeenCalled();
      await staged.admit(handoff);
      if (mode === 'edit first')
        await db.execute(
          "UPDATE synthetic_measurements SET value = 82 WHERE id = 'first'",
        );
      if (mode === 'revoke first') firstAllowed = false;
      if (mode === 'retire owner') ownerCurrent = false;
      if (mode === 'abort') controller.abort();
      release();
      await admitting;
      await staged.admit(handoff);
      expect(proof.current()).toBe(false);
      if (mode === 'unchanged') {
        expect(handoff.mock.calls).toEqual([
          [
            [
              { id: 'first', output: '61' },
              { id: 'second', output: '77' },
            ],
          ],
        ]);
      } else expect(handoff).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

test('a duplicate result ID does not reprove or expose either approval', async () => {
  const reproveSource = jest.fn(async () => true);
  const proof = { current: () => true, dispose: jest.fn() };
  const result = {
    id: 'duplicate',
    output: 'synthetic',
    current: () => true,
    reproveSource,
  };
  const staged = stageLiveResponsesResults({
    signal: new AbortController().signal,
    proof,
    results: [result, { ...result, output: 'different' }],
  });
  const handoff = jest.fn(async () => {});
  await staged.admit(handoff);
  expect(reproveSource).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
  expect(proof.dispose).toHaveBeenCalledTimes(1);
});

test('aborted staging retires its proof without executing or transferring any result', async () => {
  const signal = new AbortController();
  const reproveSource = jest.fn(async () => true);
  const proof = { current: () => true, dispose: jest.fn() };
  const staged = stageLiveResponsesResults({
    signal: signal.signal,
    proof,
    results: [
      {
        id: 'pending',
        output: 'synthetic',
        current: () => true,
        reproveSource,
      },
    ],
  });
  signal.abort();
  const handoff = jest.fn(async () => {});
  await staged.admit(handoff);
  expect(reproveSource).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
  expect(proof.dispose).toHaveBeenCalledTimes(1);
});
