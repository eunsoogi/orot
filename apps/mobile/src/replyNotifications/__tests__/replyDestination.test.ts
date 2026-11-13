import { createReplyDestination } from '../replyDestination';

const target = {
  requestId: 'request',
  sessionId: 'session',
  messageId: 'message',
  sessionVersion: '2',
};

test('keeps the target pending while entry is unavailable, then opens and acknowledges exactly that reply', async () => {
  const acknowledge = jest.fn();
  const open = jest
    .fn()
    .mockResolvedValueOnce('deferred')
    .mockResolvedValueOnce('opened');
  const destination = createReplyDestination({
    consume: async () => target,
    acknowledge,
    open,
    unavailable: jest.fn(),
  });
  expect(await destination()).toBe('deferred');
  expect(acknowledge).not.toHaveBeenCalled();
  expect(await destination()).toBe('opened');
  expect(open).toHaveBeenCalledWith({ ...target, sessionVersion: 2 });
  expect(acknowledge).toHaveBeenCalledWith('request');
});

test('explains a missing reply without opening another session', async () => {
  const unavailable = jest.fn();
  const acknowledge = jest.fn();
  const open = jest.fn().mockResolvedValue('missing');
  const destination = createReplyDestination({
    consume: async () => target,
    acknowledge,
    open,
    unavailable,
  });
  expect(await destination()).toBe('missing');
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledWith('request');
});

test('retries acknowledgement without opening the same delivery twice', async () => {
  const open = jest.fn().mockResolvedValue('opened');
  const acknowledge = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic failure'))
    .mockResolvedValue(undefined);
  const destination = createReplyDestination({
    consume: async () => ({ ...target, requestId: 'ack-retry' }),
    acknowledge,
    open,
    unavailable: jest.fn(),
  });
  await expect(destination()).rejects.toThrow();
  expect(await destination()).toBe('opened');
  expect(open).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledTimes(2);
});

test('does not re-prompt after cancellation or mutate after the observer is stopped', async () => {
  let current = true;
  const open = jest.fn().mockResolvedValue('cancelled');
  const acknowledge = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic failure'))
    .mockResolvedValue(undefined);
  const destination = createReplyDestination({
    consume: async () => ({ ...target, requestId: 'cancelled' }),
    acknowledge,
    open,
    unavailable: jest.fn(),
    isCurrent: () => current,
  });
  await expect(destination()).rejects.toThrow();
  expect(await destination()).toBe('cancelled');
  expect(open).toHaveBeenCalledTimes(1);
  current = false;
  expect(await destination()).toBe('deferred');
  expect(acknowledge).toHaveBeenCalledTimes(2);
});

test('retires an invalid head so the next valid delivery can open', async () => {
  const inbox: unknown[] = [
    { requestId: 'bad' },
    { ...target, requestId: 'valid-after-bad' },
  ];
  const discardInvalid = jest.fn(async () => {
    inbox.shift();
  });
  const open = jest.fn().mockResolvedValue('opened');
  const destination = createReplyDestination({
    consume: async () => inbox[0] ?? null,
    discardInvalid,
    acknowledge: async () => {
      inbox.shift();
    },
    open,
    unavailable: jest.fn(),
  });
  expect(await destination()).toBe('invalid');
  expect(await destination()).toBe('opened');
  expect(discardInvalid).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});

test('a stale cancellation does not acknowledge or suppress the next owner', async () => {
  let current = true;
  const acknowledge = jest.fn().mockResolvedValue(undefined);
  const open = jest
    .fn()
    .mockImplementationOnce(async () => {
      current = false;
      return 'cancelled';
    })
    .mockResolvedValueOnce('opened');
  const destination = createReplyDestination({
    consume: async () => ({ ...target, requestId: 'stale-cancel' }),
    acknowledge,
    open,
    unavailable: jest.fn(),
    isCurrent: () => current,
  });
  expect(await destination()).toBe('deferred');
  expect(acknowledge).not.toHaveBeenCalled();
  current = true;
  expect(await destination()).toBe('opened');
  expect(open).toHaveBeenCalledTimes(2);
  expect(acknowledge).toHaveBeenCalledTimes(1);
});
