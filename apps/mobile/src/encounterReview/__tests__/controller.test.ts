import { EncounterReviewController } from '../controller';
import type { EncounterReviewService } from '../controller';
import type { EncounterPending } from '@orot/agent-runtime';

import { pending } from '../__fixtures__/pending';
const consent = { authorize: jest.fn() };
function setup() {
  const service: EncounterReviewService = {
    restore: jest.fn(async () => ({ status: 'pending' as const, pending })),
    start: jest.fn(async () => ({ status: 'pending' as const, pending })),
    decide: jest.fn(async () => ({
      status: 'saved' as const,
      recordIds: ['saved'],
    })),
  };
  const controller = new EncounterReviewController(
    'recording-a',
    service,
    jest.fn(),
  );
  return { controller, service };
}

test('restore and edits cannot approve; explicit save binds displayed original and edited selection', async () => {
  const { controller, service } = setup();
  await controller.restore();
  controller.edit('candidate-0', 'text', '검토한 약물 언급');
  expect(controller.state.pending).toEqual(pending);
  expect(service.start).not.toHaveBeenCalled();
  expect(service.decide).not.toHaveBeenCalled();
  await controller.decide('approve');
  expect(service.decide).toHaveBeenCalledWith(
    'recording-a',
    expect.objectContaining({
      pending,
      decision: 'approve',
      candidates: [{ ...pending.candidates[0], text: '검토한 약물 언급' }],
    }),
    expect.anything(),
  );
  expect(controller.state.status).toBe('saved');
});

test('exclusion and denial send no candidates and duplicate clicks cannot write twice', async () => {
  const { controller, service } = setup();
  await controller.restore();
  controller.toggle('candidate-0');
  const first = controller.decide('deny');
  await controller.decide('approve');
  await first;
  expect(service.decide).toHaveBeenCalledTimes(1);
  expect(service.decide).toHaveBeenCalledWith(
    'recording-a',
    expect.objectContaining({ decision: 'deny', candidates: [] }),
    expect.anything(),
  );
});

test('cancellation and late completion cannot claim a successful save', async () => {
  const { controller, service } = setup();
  let resolve!: (value: {
    status: 'pending';
    pending: EncounterPending;
  }) => void;
  jest.mocked(service.start).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const work = controller.start(consent);
  controller.cancel();
  resolve({ status: 'pending', pending });
  await work;
  expect(controller.state.status).toBe('cancelled');
  expect(service.decide).not.toHaveBeenCalled();
});

test('failed save cannot appear successful or keep actionable stale candidates', async () => {
  const { controller, service } = setup();
  await controller.restore();
  jest
    .mocked(service.decide)
    .mockRejectedValue(new Error('Transcript changed'));
  await controller.decide('approve');
  expect(controller.state.status).toBe('unavailable');
  expect(controller.state.pending).toBeUndefined();
});
