import { createConversationRequestPreview } from '../conversationRequestPreview';

function setup() {
  let release!: (saved: boolean) => void;
  let current = true;
  const turn = {
    invalidatePreview: jest.fn(async () => 1),
    preparePreview: jest.fn(async () => true),
    writePreview: jest.fn(async (_boundary: number, _body: string) => true),
  };
  turn.writePreview.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  const reportFailure = jest.fn();
  const preview = createConversationRequestPreview({
    turn: turn as never,
    current: () => current,
    reportFailure,
  });
  return {
    turn,
    preview,
    reportFailure,
    release: (saved = true) => release(saved),
    stop: () => {
      current = false;
    },
  };
}
async function prepare(f: ReturnType<typeof setup>) {
  const boundary = await f.preview.invalidate();
  await f.preview.prepare(boundary, {
    providerId: 'synthetic',
    modelId: 'synthetic',
    sources: [],
  });
}
const delta = (text: string) => ({ type: 'text_delta' as const, text });

// The active write is never cancelled. Only redundant, not-yet-started cumulative snapshots coalesce.
test('a slow preview adapter writes the latest cumulative snapshot rather than every queued token', async () => {
  const f = setup();
  await prepare(f);
  f.preview.onStream(delta('a'));
  await Promise.resolve();
  expect(f.turn.writePreview).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 200; index++) f.preview.onStream(delta('b'));
  f.stop();
  const flushed = f.preview.flush();
  f.release();
  await flushed;
  expect(f.turn.writePreview.mock.calls).toEqual([
    [1, 'a'],
    [1, 'a' + 'b'.repeat(200)],
  ]);
  expect(f.reportFailure).not.toHaveBeenCalled();
});

test('a new input boundary waits for the latest admitted snapshot before invalidating', async () => {
  const f = setup();
  await prepare(f);
  f.preview.onStream(delta('a'));
  await Promise.resolve();
  f.preview.onStream(delta('b'));
  f.preview.onStream(delta('c'));
  const invalidating = f.preview.invalidate();
  await Promise.resolve();
  expect(f.turn.invalidatePreview).toHaveBeenCalledTimes(1);
  f.release();
  await invalidating;
  expect(f.turn.writePreview.mock.calls).toEqual([
    [1, 'a'],
    [1, 'abc'],
  ]);
  expect(f.turn.invalidatePreview).toHaveBeenCalledTimes(2);
  f.preview.onStream(delta('not admitted'));
  await f.preview.flush();
  expect(f.turn.writePreview).toHaveBeenCalledTimes(2);
});

test('reset and replacement snapshots are not erased by later cumulative deltas', async () => {
  const f = setup();
  await prepare(f);
  f.preview.onStream(delta('a'));
  await Promise.resolve();
  f.preview.onStream(delta('b'));
  f.preview.onStream({ type: 'started' });
  f.preview.onStream(delta('replacement'));
  f.preview.onStream(delta(' tail'));
  f.release();
  await f.preview.flush();
  expect(f.turn.writePreview.mock.calls.map(call => call[1])).toEqual([
    'a',
    'ab',
    'replacement tail',
  ]);
});

test('an oversized pending snapshot cannot erase the previous bounded snapshot', async () => {
  const f = setup();
  await prepare(f);
  f.preview.onStream(delta('a'));
  await Promise.resolve();
  f.preview.onStream(delta('b'));
  f.preview.onStream(delta('c'.repeat(64_000)));
  f.release();
  await f.preview.flush();
  expect(f.turn.writePreview.mock.calls.map(call => call[1].length)).toEqual([
    1, 2, 64_002,
  ]);
});

test.each([false, 'throw'])(
  'failed active write %s preserves queued settlement and rejects new input',
  async failure => {
    const f = setup();
    await prepare(f);
    f.preview.onStream(delta('a'));
    await Promise.resolve();
    f.preview.onStream(delta('b'));
    f.preview.onStream(delta('c'));
    if (failure === 'throw')
      f.turn.writePreview.mockRejectedValueOnce(
        new Error('synthetic storage failure'),
      );
    f.release(failure !== false);
    await f.preview.flush();
    f.preview.onStream(delta('ignored'));
    await f.preview.flush();
    expect(f.turn.writePreview).toHaveBeenCalledTimes(2);
    expect(f.reportFailure).toHaveBeenCalledTimes(1);
  },
);

test('replacement/shrink events retain their position before the new boundary', async () => {
  const f = setup();
  await prepare(f);
  f.preview.onStream(delta('first'));
  await Promise.resolve();
  f.preview.onStream(delta(' tail'));
  f.preview.onStream({ type: 'text_snapshot', text: 'new' });
  f.preview.onStream(delta(' tail'));
  f.turn.invalidatePreview.mockResolvedValueOnce(2);
  const next = f.preview.invalidate();
  f.release();
  const boundary = await next;
  await f.preview.prepare(boundary, {
    providerId: 'synthetic',
    modelId: 'synthetic',
    sources: [],
  });
  f.preview.onStream(delta('next boundary'));
  await f.preview.flush();
  expect(f.turn.writePreview.mock.calls).toEqual([
    [1, 'first'],
    [1, 'first tail'],
    [1, 'new tail'],
    [2, 'next boundary'],
  ]);
});
