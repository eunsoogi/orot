import { createReviewDiagnostics } from '../diagnostics';
import { EncounterReviewController } from '../controller';
import type { EncounterReviewService } from '../controller';

test('unavailable captures rows despite status, sanitized earliest cause, and the actual model counter', async () => {
  const rows = jest.fn(async () => 2);
  let calls = 0;
  const emit = jest.fn();
  const diagnostics = createReviewDiagnostics('owned', rows, () => calls, emit);
  const service: EncounterReviewService = {
    diagnostics,
    restore: async () => ({ status: 'idle' }),
    decide: async () => ({ status: 'unavailable' }),
    async start() {
      calls++;
      diagnostics.stage('transcript_read');
      throw new TypeError('private health transcript SQL userinfo prompt');
    },
  };
  const controller = new EncounterReviewController('owned', service, jest.fn());
  await controller.start({ authorize: jest.fn() });
  expect(controller.state.status).toBe('unavailable');
  expect(await diagnostics.snapshot()).toEqual({
    attempt: 1,
    phase: 'running',
    status: 'unavailable',
    recordCount: 2,
    modelCalls: 1,
    failure: { stage: 'transcript_read', category: 'type_error' },
  });
  expect(rows).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(emit.mock.calls)).not.toMatch(
    /private|health|SQL|userinfo|prompt|owned/,
  );
});

test('overlapping SQL completion cannot relabel a previous attempt and mismatched source cannot emit', async () => {
  let resolve!: (count: number) => void;
  const rows = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>(done => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(2);
  const emit = jest.fn();
  const diagnostics = createReviewDiagnostics('owned', rows, () => 0, emit);
  diagnostics.begin('running', 'owned');
  const oldAttempt = diagnostics.current();
  const first = diagnostics.snapshot();
  diagnostics.settled('pending');
  diagnostics.begin('saving', 'owned');
  oldAttempt.capture({ stage: 'graph_invoke', category: 'type_error' });
  diagnostics.settled('saved');
  resolve(2);
  expect(await first).toMatchObject({
    attempt: 1,
    phase: 'running',
    status: 'pending',
    recordCount: 'UNKNOWN',
    failure: { stage: 'record_count', category: 'UNKNOWN' },
  });
  expect(await diagnostics.snapshot()).toMatchObject({
    attempt: 2,
    phase: 'saving',
    status: 'saved',
    recordCount: 2,
    failure: { stage: 'UNKNOWN', category: 'UNKNOWN' },
  });
  diagnostics.begin('loading', 'foreign');
  diagnostics.settled('pending');
  expect(diagnostics.snapshot()).toBeUndefined();
  expect(rows).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenCalledTimes(2);
});

test('missing SQL and unknown cause stay UNKNOWN; a broken sink cannot change outcome', async () => {
  const diagnostics = createReviewDiagnostics(
    'owned',
    async () => {
      throw new Error('private SQL');
    },
    () => 0,
    () => {
      throw new Error('sink');
    },
  );
  diagnostics.begin('running', 'owned');
  diagnostics.caught({ message: 'private health' });
  diagnostics.settled('unavailable');
  expect(await diagnostics.snapshot()).toMatchObject({
    recordCount: 'UNKNOWN',
    failure: { stage: 'controller', category: 'UNKNOWN' },
  });
  diagnostics.begin('loading', 'owned');
  diagnostics.settled('pending');
  expect(await diagnostics.snapshot()).toMatchObject({
    attempt: 2,
    failure: { stage: 'record_count', category: 'UNKNOWN' },
  });
});
