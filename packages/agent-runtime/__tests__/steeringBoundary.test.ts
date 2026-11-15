import type { LanguageModelRequest } from '@orot/model-runtime';
import { createSteeringQueue } from '../src/multiAgent/steeringQueue';
import { prepareSteeringBoundary } from '../src/multiAgent/steeringBoundary';

function setup() {
  const owner = 'synthetic-owner';
  const queue = createSteeringQueue(owner);
  const controller = new AbortController();
  const request: LanguageModelRequest = { messages: [{ role: 'user', content: 'Original' }] };
  const bindProtectedRevision = jest.fn(async () => true);
  queue.enqueue(owner, 'first', 'Use simpler words');
  return {
    owner,
    queue,
    request,
    signal: controller.signal,
    controller,
    pendingOperation: false,
    paused: false,
    bindProtectedRevision,
  };
}

describe('protected steering payload boundary', () => {
  it('binds a subsequent payload without mutating the active request or claiming delivery', async () => {
    const input = setup();
    const result = await prepareSteeringBoundary(input);
    expect(result).toMatchObject({
      status: 'prepared',
      request: {
        messages: [
          { role: 'user', content: 'Original' },
          { role: 'user', content: 'Use simpler words' },
        ],
      },
    });
    expect(input.request.messages).toHaveLength(1);
    expect(input.bindProtectedRevision).toHaveBeenCalledTimes(1);
    expect(input.queue.snapshot()[0].status).toBe('prepared');
  });
  it.each(['pendingOperation', 'paused'] as const)(
    'blocks %s without changing the queue',
    async (flag) => {
      const input = setup();
      expect(await prepareSteeringBoundary({ ...input, [flag]: true })).toEqual({
        status: 'blocked',
      });
      expect(input.bindProtectedRevision).not.toHaveBeenCalled();
      expect(input.queue.snapshot()[0].status).toBe('queued');
    },
  );
  it('does not replay a prepared revision', async () => {
    const input = setup();
    await prepareSteeringBoundary(input);
    expect(await prepareSteeringBoundary(input)).toEqual({ status: 'blocked' });
    expect(input.bindProtectedRevision).toHaveBeenCalledTimes(1);
  });
  it.each(['rejected', 'throws', 'cancelled'] as const)(
    'fails closed for %s binding',
    async (mode) => {
      const input = setup();
      input.bindProtectedRevision.mockImplementation(async () => {
        if (mode === 'throws') throw new Error('synthetic private error');
        if (mode === 'cancelled') input.controller.abort();
        return mode !== 'rejected';
      });
      expect(await prepareSteeringBoundary(input)).toEqual({ status: 'blocked' });
      expect(input.queue.snapshot()[0].status).toBe('not_applied');
      expect(input.queue.acknowledge(input.owner, 1)).toBe(false);
    },
  );
  it('rejects payload mutation while binding', async () => {
    const input = setup();
    const result = await prepareSteeringBoundary({
      ...input,
      bindProtectedRevision: async (binding) => {
        Object.assign(binding.batch.instructions[0], { text: 'Changed' });
        return true;
      },
    });
    expect(result).toEqual({ status: 'blocked' });
    expect(input.queue.snapshot()[0].text).toBe('Use simpler words');
  });
  it('keeps later steering queued until a later boundary', async () => {
    const input = setup();
    const result = await prepareSteeringBoundary({
      ...input,
      bindProtectedRevision: async () => {
        input.queue.enqueue(input.owner, 'second', 'Be concise');
        return true;
      },
    });
    expect(result.status).toBe('prepared');
    expect(input.queue.snapshot().map((item) => item.status)).toEqual(['prepared', 'queued']);
  });
});

// A Stop/deletion may happen while the journal transaction is awaiting completion.
it.each(['close', 'clear'] as const)('fences %s during binding', async (method) => {
  const input = setup();
  const result = await prepareSteeringBoundary({
    ...input,
    bindProtectedRevision: async () => {
      input.queue[method](input.owner);
      return true;
    },
  });
  expect(result).toEqual({ status: 'blocked' });
});
it('rejects stale ownership and closed empty queues before any dispatch preparation', async () => {
  const input = setup();
  expect(await prepareSteeringBoundary({ ...input, owner: 'stale' })).toEqual({
    status: 'blocked',
  });
  input.queue.clear(input.owner);
  expect(await prepareSteeringBoundary(input)).toEqual({ status: 'blocked' });
  expect(input.bindProtectedRevision).not.toHaveBeenCalled();
});
