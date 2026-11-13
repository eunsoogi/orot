import { createReplyNotificationCoordinator } from '../replyNotificationCoordinator';

const identity = {
  requestId: 'r',
  sessionId: 's',
  messageId: 'm',
  sessionVersion: 0,
};

function fixture() {
  let background = true;
  let valid = true;
  const claimed = new Set<string>();
  const submit = jest.fn(
    async (): Promise<'submitted' | 'suppressed' | 'failed'> => 'submitted',
  );
  const coordinator = createReplyNotificationCoordinator({
    isBackground: () => background,
    isEnabled: async () => true,
    isAuthorized: async () => true,
    lease: async () => ({ global: 0, session: 0 }),
    readAnswer: async () => (valid ? '합성 답변입니다.' : null),
    claim: async (key, eligible) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return eligible;
    },
    release: async key => {
      claimed.delete(key);
    },
    start: async () => {},
    finish: async () => {},
    submit,
  });
  return {
    coordinator,
    submit,
    foreground: () => {
      background = false;
    },
    background: () => {
      background = true;
    },
    invalidate: () => {
      valid = false;
    },
  };
}

test('submits a current background completion only once', async () => {
  const f = fixture();
  await Promise.all([
    f.coordinator.consume(identity),
    f.coordinator.consume(identity),
  ]);
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(f.submit).toHaveBeenCalledWith(identity, '합성 답변입니다.', {
    global: 0,
    session: 0,
  });
});

test('suppresses foreground or invalid answers', async () => {
  const foreground = fixture();
  foreground.foreground();
  await foreground.coordinator.consume(identity);
  const deleted = fixture();
  deleted.invalidate();
  await deleted.coordinator.consume(identity);
  expect(foreground.submit).not.toHaveBeenCalled();
  expect(deleted.submit).not.toHaveBeenCalled();
});

test('a foreground completion cannot be replayed after backgrounding', async () => {
  const f = fixture();
  f.foreground();
  await f.coordinator.consume(identity);
  f.background();
  await f.coordinator.consume(identity);
  expect(f.submit).not.toHaveBeenCalled();
});

test('rechecks authorization and freshness after asynchronous work', async () => {
  const submit = jest.fn();
  const isAuthorized = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const readAnswer = jest.fn().mockResolvedValue('합성 답변');
  const coordinator = createReplyNotificationCoordinator({
    isBackground: () => true,
    isEnabled: async () => true,
    isAuthorized,
    lease: async () => ({ global: 0, session: 0 }),
    readAnswer,
    claim: async () => true,
    release: async () => {},
    start: async () => {},
    finish: async () => {},
    submit,
  });
  await coordinator.consume(identity);
  expect(submit).not.toHaveBeenCalled();
  isAuthorized.mockResolvedValue(true);
  readAnswer.mockResolvedValueOnce('합성 답변').mockResolvedValueOnce(null);
  await coordinator.consume(identity);
  expect(submit).not.toHaveBeenCalled();
});

test('a definite submission failure can be retried without duplicating a successful submission', async () => {
  const f = fixture();
  f.submit.mockResolvedValueOnce('failed').mockResolvedValue('submitted');
  await f.coordinator.consume(identity);
  await f.coordinator.consume(identity);
  await f.coordinator.consume(identity);
  expect(f.submit).toHaveBeenCalledTimes(2);
});
