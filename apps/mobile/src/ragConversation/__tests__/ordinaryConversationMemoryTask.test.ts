import type { SqlDatabase } from '@orot/storage';
import {
  beginOrdinaryConversationMemoryTask,
  type OrdinaryConversationMemoryPort,
} from '../ordinaryConversationMemoryTask';
import type { ConversationRetentionCandidate } from '../conversationRetention';

const question = 'For future replies, I prefer concise answers.';
const source = {
  requestId: 'synthetic-request',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  question,
  createdAt: '2026-11-22T00:00:00.000Z',
};
const candidate: ConversationRetentionCandidate = {
  question,
  answer: 'Synthetic answer is not memory text.',
  proactiveMemory: true,
  providerId: 'synthetic',
  modelId: 'synthetic',
  sources: [],
  citations: [],
};
const live = () => true;

function fixture() {
  let release!: (
    value: Awaited<ReturnType<OrdinaryConversationMemoryPort['capture']>>,
  ) => void;
  const held = new Promise<
    Awaited<ReturnType<OrdinaryConversationMemoryPort['capture']>>
  >(resolve => {
    release = resolve;
  });
  const receipt = {
    database: {} as SqlDatabase,
    deviceEpoch: 'a'.repeat(64),
    generation: 1,
    isCurrent: live,
  };
  const port = {
    capture: jest.fn(() => held),
    save: jest.fn(async (_receipt, _source, current: () => boolean) =>
      current(),
    ),
  };
  const controller = new AbortController();
  return { port, receipt, release, controller };
}

test('takes one permission snapshot before awaiting and consumes one exact source only after presentation', async () => {
  const f = fixture();
  const task = beginOrdinaryConversationMemoryTask(
    f.port,
    question,
    f.controller.signal,
  )!;
  expect(f.port.capture).toHaveBeenCalledTimes(1);
  task.attach(source);
  task.propose(candidate);
  expect(f.port.save).not.toHaveBeenCalled();
  const first = task.finish(live);
  await expect(task.finish(live)).resolves.toBe(false);
  f.release(f.receipt);
  await expect(first).resolves.toBe(true);
  expect(f.port.save).toHaveBeenCalledWith(
    f.receipt,
    source,
    expect.any(Function),
  );
  expect(f.port.save).toHaveBeenCalledTimes(1);
});

test.each(['steered', 'stopped', 'new owner', 'not opted in'])(
  'ordinary answer completion does not save a note for %s',
  async invalidation => {
    const f = fixture();
    const task = beginOrdinaryConversationMemoryTask(
      f.port,
      question,
      f.controller.signal,
    )!;
    task.attach(source);
    task.propose(candidate);
    let owner = true;
    const finish = task.finish(() => owner);
    if (invalidation === 'steered') task.discard();
    if (invalidation === 'stopped') f.controller.abort();
    if (invalidation === 'new owner') owner = false;
    f.release(invalidation === 'not opted in' ? undefined : f.receipt);
    await expect(finish).resolves.toBe(false);
    expect(f.port.save).not.toHaveBeenCalled();
  },
);

test('partial or mismatched first retention consumes the attempt without a later rewrite', async () => {
  const f = fixture();
  const task = beginOrdinaryConversationMemoryTask(
    f.port,
    question,
    f.controller.signal,
  )!;
  task.attach(source);
  task.propose({ ...candidate, status: 'partial' });
  task.propose(candidate);
  f.release(f.receipt);
  await expect(task.finish(live)).resolves.toBe(false);
  expect(f.port.save).not.toHaveBeenCalled();
});

test('does not acquire authority for unrelated authored text', () => {
  const f = fixture();
  expect(
    beginOrdinaryConversationMemoryTask(
      f.port,
      'What happened today?',
      f.controller.signal,
    ),
  ).toBeUndefined();
  expect(f.port.capture).not.toHaveBeenCalled();
});
