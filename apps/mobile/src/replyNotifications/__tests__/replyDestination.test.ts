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
