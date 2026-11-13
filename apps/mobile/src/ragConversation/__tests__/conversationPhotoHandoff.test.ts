import { createConversationPhotoDrafts } from '../conversationPhotoDraft';

const identity = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  inputRevision: 1,
};
const photo = { id: 'synthetic' };

test('a committed request takes ownership without discarding the protected original', async () => {
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  expect(lease.photo).toBe(photo);
  expect(lease.identity).toEqual(identity);
  expect(drafts.beginHandoff(1, identity)).toBeNull();
  expect(drafts.get(1).status).toBe('transferring');
  expect(lease.commit()).toEqual({ photo, removed: false });
  expect(drafts.get(1)).toEqual({ status: 'empty' });
  expect(discard).not.toHaveBeenCalled();
  expect(lease.commit()).toBeNull();
});

test('a confirmed failed checkpoint returns ownership to the same draft', async () => {
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  await lease.rollback();
  expect(drafts.get(1)).toEqual({ status: 'ready', photo });
  expect(discard).not.toHaveBeenCalled();
});

test('removal waits for checkpoint resolution and never deletes a committed request original', async () => {
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  const removal = drafts.remove(1);
  expect(drafts.get(1)).toEqual({ status: 'empty' });
  expect(discard).not.toHaveBeenCalled();
  const committed = lease.commit();
  expect(committed).toMatchObject({ photo, removed: true });
  if (!committed || !committed.removed)
    throw new Error('Expected removal ownership.');
  let finished = false;
  removal.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  committed.acknowledgeRemoval({ ok: true });
  await removal;
  expect(discard).not.toHaveBeenCalled();
});

test('global deletion waits for the request owner to retire a committed original', async () => {
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  const clearing = drafts.clear();
  expect(drafts.get(1)).toEqual({ status: 'empty' });
  const committed = lease.commit();
  if (!committed || !committed.removed)
    throw new Error('Expected removal ownership.');
  expect(discard).not.toHaveBeenCalled();
  committed.acknowledgeRemoval({
    ok: false,
    error: new Error('request cleanup failed'),
  });
  await expect(clearing).rejects.toThrow('request cleanup failed');
  expect(discard).not.toHaveBeenCalled();
});

test('failed cleanup after rollback stays owned for a later retry', async () => {
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  const removal = drafts.remove(1);
  await expect(lease.rollback()).rejects.toThrow('locked');
  await expect(removal).rejects.toThrow('locked');
  expect(drafts.cleanupPending(1)).toBe(true);
  await drafts.retryCleanup(1);
  expect(drafts.cleanupPending(1)).toBe(false);
});

test('invalid identity cannot acquire the staged original', async () => {
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard: async () => {},
  });
  await drafts.select(1);
  expect(drafts.beginHandoff(1, { ...identity, requestId: '' })).toBeNull();
  expect(drafts.get(1)).toEqual({ status: 'ready', photo });
});

test('a source invalidated before or during checkpoint cannot remain visible or transfer as active', async () => {
  let valid = true;
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
    captureValidity: () => () => valid,
  });
  await drafts.select(1);
  valid = false;
  expect(drafts.beginHandoff(1, identity)).toBeNull();
  valid = true;
  const lease = drafts.beginHandoff(1, identity)!;
  valid = false;
  const committed = lease.commit();
  if (!committed || !committed.removed)
    throw new Error('Expected invalid source retirement.');
  expect(drafts.get(1)).toEqual({ status: 'empty' });
  committed.acknowledgeRemoval({ ok: true });
  expect(discard).not.toHaveBeenCalled();
});

test('removal retires the draft original only after a checkpoint is confirmed absent', async () => {
  const discard = jest.fn().mockResolvedValue(undefined);
  const drafts = createConversationPhotoDrafts({
    pick: async () => photo,
    discard,
  });
  await drafts.select(1);
  const lease = drafts.beginHandoff(1, identity)!;
  const removal = drafts.remove(1);
  expect(discard).not.toHaveBeenCalled();
  await lease.rollback();
  await removal;
  expect(discard).toHaveBeenCalledTimes(1);
});
