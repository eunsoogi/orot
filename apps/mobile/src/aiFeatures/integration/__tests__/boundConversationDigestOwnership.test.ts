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
