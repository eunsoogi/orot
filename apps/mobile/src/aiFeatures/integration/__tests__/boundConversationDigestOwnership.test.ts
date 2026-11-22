import * as scopes from '../conversationCaptureReadScope';
import { readOwnedBoundParentRows } from '../../../storage/conversationArtifactRead';
import { boundConversationDigestFixture as fixture } from '../testSupport/boundConversationDigestFixture';

test('byte witnesses cannot be forged or borrowed across reader, owner, signal or callback replacement', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const operation = f.storage.beginReadOperation(signal)!;
  const claim = jest.fn();
  const fake = { ...operation, readBoundParentRows: claim };
  const selected = [f.parent.id];
  try {
    expect(
      readOwnedBoundParentRows(fake, f.storage, signal, selected),
    ).toBeUndefined();
    expect(
      readOwnedBoundParentRows(operation, {}, signal, selected),
    ).toBeUndefined();
    expect(
      readOwnedBoundParentRows(
        operation,
        f.storage,
        new AbortController().signal,
        selected,
      ),
    ).toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
    const witnessed = await readOwnedBoundParentRows(
      operation,
      f.storage,
      signal,
      selected,
    );
    expect(witnessed?.tokens).toHaveLength(1);
    const replacement = jest.fn(operation.readMany);
    operation.readMany = replacement;
    expect(witnessed?.tokens).toBeUndefined();
    await expect(
      readOwnedBoundParentRows(operation, f.storage, signal, selected),
    ).resolves.toBeUndefined();
    expect(replacement).not.toHaveBeenCalled();
    expect(await operation.readMany(selected)).toHaveLength(1);
    expect(replacement).toHaveBeenCalledWith(selected);
  } finally {
    operation.dispose();
    f.close();
  }
});

test('only adjacent identical owned values share a retained body after strict validation', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const operation = f.storage.beginReadOperation(signal)!;
  const alternate = { ...f.parent, id: 'owned-alternate' };
  await f.storage.append(alternate);
  const read = (ids: readonly string[]) =>
    readOwnedBoundParentRows(operation, f.storage, signal, ids);
  try {
    const consecutive = await read([f.parent.id, f.parent.id]);
    expect(consecutive?.rows?.[0]).toBe(consecutive?.rows?.[1]);
    expect(consecutive?.tokens?.[0]).toBe(consecutive?.tokens?.[1]);
    const alternating = await read([f.parent.id, alternate.id, f.parent.id]);
    expect(alternating?.rows?.[0]).not.toBe(alternating?.rows?.[2]);
    expect(alternating?.rows?.map(row => row?.id)).toEqual([
      f.parent.id,
      alternate.id,
      f.parent.id,
    ]);
    operation.readMany = async () => [];
    expect(consecutive?.rows).toBeUndefined();
    expect(consecutive?.tokens).toBeUndefined();
    expect(alternating?.rows).toHaveLength(3);
    expect(alternating?.tokens).toBeUndefined();
  } finally {
    operation.dispose();
    f.close();
  }
});

test.each(['before', 'during-final-read'] as const)(
  'begin-only drift retains the strict fallback for repeated aliases [%s]',
  async mode => {
    const f = await fixture();
    const begin = f.storage.beginReadOperation;
    const replace = () => {
      f.storage.beginReadOperation = (...args) => begin.apply(f.storage, args);
    };
    const refs = [f.bind(f.parent), f.bind(f.parent)];
    const roots = f.observeRoots(
      new Set([f.parent.id]),
      async (_id, ordinal) => {
        if (mode === 'during-final-read' && ordinal === 3) replace();
      },
    );
    if (mode === 'before') replace();
    try {
      expect((await f.capture(refs)).mapping.size).toBe(2);
      expect(roots.counts).toHaveLength(mode === 'before' ? 4 : 6);
    } finally {
      roots.restore();
      f.close();
    }
  },
);

test('a revoked shared result cannot substitute stale scoped rows for a committed parent deletion', async () => {
  const f = await fixture();
  const original = scopes.createConversationCaptureReadScope;
  const created: ReturnType<typeof original>[] = [];
  const spy = jest
    .spyOn(scopes, 'createConversationCaptureReadScope')
    .mockImplementation(signal => {
      const scope = original(signal);
      created.push(scope);
      return scope;
    });
  const spoof = jest.fn(async () => [f.parent, f.parent, f.parent]);
  const refs = Array.from({ length: 3 }, () => f.bind(f.parent));
  const roots = f.observeRoots(new Set([f.parent.id]), async (_, ordinal) => {
    if (ordinal !== 5) return;
    const operation = created[0]!.forStorage(f.storage)!;
    operation.readMany = spoof;
    const removed = await f.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      [f.parent.id],
    );
    expect(removed.rowsAffected).toBe(1);
  });
  try {
    await expect(f.capture(refs)).rejects.toThrow();
    expect(spoof).not.toHaveBeenCalled();
    expect(roots.counts).toHaveLength(9);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ?',
          [f.parent.id],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    spy.mockRestore();
    roots.restore();
    f.close();
  }
});
