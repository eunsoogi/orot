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
  const rows = jest.fn(
    () =>
      new Promise<number>(done => {
        resolve = done;
      }),
  );
  const emit = jest.fn();
  const diagnostics = createReviewDiagnostics('owned', rows, () => 0, emit);
  diagnostics.begin('running', 'owned');
  const oldAttempt = diagnostics.current();
  diagnostics.capture({ stage: 'extract_candidates', category: 'error' });
  diagnostics.capture({ stage: 'graph_invoke', category: 'type_error' });
  diagnostics.settled('unavailable');
  const first = diagnostics.snapshot();
  diagnostics.begin('loading', 'foreign');
  oldAttempt.capture({ stage: 'graph_invoke', category: 'type_error' });
  diagnostics.settled('pending');
  expect(diagnostics.snapshot()).toBeUndefined();
  resolve(0);
  expect(await first).toMatchObject({
    attempt: 1,
    phase: 'running',
    status: 'unavailable',
    failure: { stage: 'extract_candidates', category: 'error' },
  });
  expect(rows).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledTimes(1);
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
