import { createConversationPhotoDrafts } from '../conversationPhotoDraft';

const photo = (id: string) => ({ id });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

test('selection stays with its session and cancellation preserves the existing draft', async () => {
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('one'))
    .mockResolvedValueOnce(null);
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({ pick, discard });
  await drafts.select(1);
  await drafts.select(2);
  expect(drafts.get(1)).toEqual({ status: 'ready', photo: photo('one') });
  expect(drafts.get(2)).toEqual({ status: 'empty' });
  expect(discard).not.toHaveBeenCalled();
});

test('a late selection after removal is discarded and cannot populate a newer draft', async () => {
  const first = deferred<{ id: string } | null>();
  const pick = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(photo('new'));
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({ pick, discard });
  const pending = drafts.select(1);
  await drafts.remove(1);
  first.resolve(photo('old'));
  await pending;
  await drafts.select(1);
  expect(drafts.get(1)).toEqual({ status: 'ready', photo: photo('new') });
  expect(discard).toHaveBeenCalledWith(photo('old'));
});

test('does not queue a second system picker behind an active selection in another session', async () => {
  const first = deferred<{ id: string } | null>();
  const pick = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(photo('second'));
  const drafts = createConversationPhotoDrafts({
    pick,
    discard: async () => {},
  });
  const pending = drafts.select(1);
  await drafts.select(2);
  expect(pick).toHaveBeenCalledTimes(1);
  first.resolve(null);
  await pending;
  await drafts.select(2);
  expect(drafts.get(2)).toEqual({ status: 'ready', photo: photo('second') });
});

test('failed replacement preserves the previous photo and exposes an error', async () => {
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('one'))
    .mockRejectedValueOnce(new Error('failed'));
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({ pick, discard });
  await drafts.select(1);
  await drafts.select(1);
  expect(drafts.get(1)).toEqual({ status: 'error', photo: photo('one') });
  expect(discard).not.toHaveBeenCalled();
});

test('removal retains ownership when protected-file cleanup fails', async () => {
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo('one'),
    discard,
  });
  await drafts.select(1);
  await expect(drafts.remove(1)).rejects.toThrow();
  expect(drafts.get(1)).toEqual({ status: 'error', photo: photo('one') });
  await drafts.remove(1);
  expect(drafts.get(1)).toEqual({ status: 'empty' });
});

test('replacement and removal do not discard the same original concurrently', async () => {
  const cleanup = deferred<void>();
  const discard = jest.fn().mockReturnValue(cleanup.promise);
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('one'))
    .mockResolvedValueOnce(photo('two'));
  const drafts = createConversationPhotoDrafts({ pick, discard });
  await drafts.select(1);
  const replacement = drafts.select(1);
  await Promise.resolve();
  const removal = drafts.remove(1);
  expect(discard).toHaveBeenCalledTimes(1);
  cleanup.resolve();
  await Promise.all([replacement, removal]);
});

test('failed cleanup of a stale selection remains owned and can be retried', async () => {
  const pending = deferred<{ id: string } | null>();
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: () => pending.promise,
    discard,
  });
  const selection = drafts.select(1);
  await drafts.remove(1);
  pending.resolve(photo('stale'));
  await expect(selection).rejects.toThrow('locked');
  expect(drafts.cleanupPending(1)).toBe(true);
  await drafts.retryCleanup(1);
  expect(drafts.cleanupPending(1)).toBe(false);
  expect(discard).toHaveBeenCalledTimes(2);
});

test('a new picker cannot resurrect an original while its removal is in flight', async () => {
  const pending = deferred<void>();
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('one'))
    .mockResolvedValueOnce(null);
  const drafts = createConversationPhotoDrafts({
    pick,
    discard: () => pending.promise,
  });
  await drafts.select(1);
  const removal = drafts.remove(1);
  await drafts.select(1);
  expect(pick).toHaveBeenCalledTimes(1);
  pending.resolve();
  await removal;
  expect(drafts.get(1)).toEqual({ status: 'empty' });
});

test('failed replacement cleanup preserves the previous photo even if discarding the replacement also fails', async () => {
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('old'))
    .mockResolvedValueOnce(photo('new'));
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('old locked'))
    .mockRejectedValueOnce(new Error('new locked'));
  const drafts = createConversationPhotoDrafts({ pick, discard });
  await drafts.select(1);
  await expect(drafts.select(1)).rejects.toThrow('new locked');
  expect(drafts.get(1)).toEqual({ status: 'error', photo: photo('old') });
  expect(drafts.cleanupPending(1)).toBe(true);
});

test('subscribers observe preparation, selection and removal for the owning session', async () => {
  const selected = deferred<{ id: string } | null>();
  const drafts = createConversationPhotoDrafts({
    pick: () => selected.promise,
    discard: async () => {},
  });
  const updates: string[] = [];
  const unsubscribe = drafts.subscribe(() =>
    updates.push(drafts.get(1).status),
  );
  const picking = drafts.select(1);
  selected.resolve(photo('one'));
  await picking;
  await drafts.remove(1);
  unsubscribe();
  expect(updates).toEqual(['preparing', 'ready', 'ready', 'empty']);
  expect(drafts.get(2)).toBe(drafts.get(2));
});

test('a synchronous session removal before picker presentation cancels selection', async () => {
  const pick = jest.fn().mockResolvedValue(photo('unexpected'));
  const drafts = createConversationPhotoDrafts({
    pick,
    discard: async () => {},
  });
  drafts.subscribe(() => {
    if (drafts.get(1).status === 'preparing') drafts.remove(1).catch(() => {});
  });
  await drafts.select(1);
  expect(pick).not.toHaveBeenCalled();
  expect(drafts.get(1)).toEqual({ status: 'empty' });
});

test('clearing all sessions discards staged photos and invalidates pending picks', async () => {
  const late = deferred<{ id: string } | null>();
  const pick = jest
    .fn()
    .mockResolvedValueOnce(photo('first'))
    .mockReturnValueOnce(late.promise);
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({ pick, discard });
  await drafts.select(1);
  const pending = drafts.select(2);
  await drafts.clear();
  late.resolve(photo('late'));
  await pending;
  expect(drafts.get(1).status).toBe('empty');
  expect(drafts.get(2).status).toBe('empty');
  expect(discard).toHaveBeenCalledWith(photo('first'));
  expect(discard).toHaveBeenCalledWith(photo('late'));
});

test('clearing joins an in-flight removal and reports its cleanup failure', async () => {
  let reject!: (error: Error) => void;
  const cleanup = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo('one'),
    discard: () => cleanup,
  });
  await drafts.select(1);
  const removal = drafts.remove(1);
  const clearing = drafts.clear();
  reject(new Error('cleanup failed'));
  await expect(removal).rejects.toThrow('cleanup failed');
  await expect(clearing).rejects.toThrow('cleanup failed');
  expect(drafts.get(1)).toEqual({ status: 'empty' });
});

test('clearing retries previously failed cleanup of a retired selection', async () => {
  const late = deferred<{ id: string } | null>();
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: () => late.promise,
    discard,
  });
  const selection = drafts.select(1);
  await drafts.remove(1);
  late.resolve(photo('retired'));
  await expect(selection).rejects.toThrow('locked');
  await drafts.clear();
  expect(discard).toHaveBeenCalledTimes(2);
  expect(drafts.cleanupPending(1)).toBe(false);
});
