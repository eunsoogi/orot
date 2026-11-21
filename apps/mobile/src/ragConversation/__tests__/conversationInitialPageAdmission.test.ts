import { createConversationInitialPageAdmission } from '../conversationInitialPageAdmission';

test('stale release does not wake the same flight and a reclose invalidates an admitted epoch', async () => {
  const gate = createConversationInitialPageAdmission();
  const signal = new AbortController().signal;
  const releaseOld = gate.hold();
  const admitted = jest.fn();
  const pending = gate.wait(signal).then(admitted);
  const release = gate.hold();
  releaseOld();
  await Promise.resolve();
  expect(admitted).not.toHaveBeenCalled();

  release();
  await pending;
  expect(admitted).toHaveBeenCalledTimes(1);
  const assertCurrent = admitted.mock.calls[0]![0] as () => void;
  expect(assertCurrent).not.toThrow();

  const releaseAgain = gate.hold();
  expect(assertCurrent).toThrow();
  releaseAgain();
  expect(assertCurrent).toThrow();
  expect(await gate.wait(signal)).not.toThrow();
});

test('abort releases the quiet wait without an authority response', async () => {
  const gate = createConversationInitialPageAdmission();
  const owner = new AbortController();
  const release = gate.hold();
  const pending = gate.wait(owner.signal);
  owner.abort();
  await expect(pending).rejects.toThrow('cancelled');
  release();
  expect(await gate.wait(new AbortController().signal)).not.toThrow();
});

test('synchronous reclose wins before an awakened waiter can admit', async () => {
  const gate = createConversationInitialPageAdmission();
  const owner = new AbortController();
  const release = gate.hold();
  const admitted = jest.fn();
  const pending = gate.wait(owner.signal).then(admitted);
  release();
  const newest = gate.hold();
  await Promise.resolve();
  expect(admitted).not.toHaveBeenCalled();
  newest();
  await pending;
  expect(admitted).toHaveBeenCalledTimes(1);
});
