import {
  sqliteReviewFixture,
  sourceId,
  consent,
} from '../__fixtures__/sqliteReview';
import type { EncounterApproval, EncounterPending } from '@orot/agent-runtime';

const { controllerFor, rows } = sqliteReviewFixture();
const approvalFor = (pending: EncounterPending): EncounterApproval => ({
  pending,
  decision: 'approve',
  candidates: pending.candidates,
  reviewerId: 'local-user',
  reviewedAt: '2035-01-02T00:00:00Z',
});

test('completed review accepts only the identical approval and never reports another controller decision as saved', async () => {
  const first = controllerFor();
  await first.controller.start(consent);
  const second = controllerFor(false, false);
  await second.controller.restore();
  expect(second.controller.state.pending).toEqual(
    first.controller.state.pending,
  );
  const approval = approvalFor(first.controller.state.pending!);
  const signal = new AbortController().signal;
  const committed = await first.service.decide(sourceId, approval, signal);
  expect(committed.status).toBe('saved');
  expect(await second.service.decide(sourceId, approval, signal)).toEqual(
    committed,
  );
  const records = await rows();
  expect(
    await second.service.decide(
      sourceId,
      {
        ...approval,
        candidates: approval.candidates.map(candidate => ({
          ...candidate,
          text: '다른 화면의 수정',
        })),
      },
      signal,
    ),
  ).toEqual({ status: 'unavailable' });
  expect(
    await second.service.decide(
      sourceId,
      {
        ...approval,
        decision: 'deny',
        candidates: [],
      },
      signal,
    ),
  ).toEqual({ status: 'unavailable' });
  expect(await rows()).toEqual(records);
  expect(second.synthetic.calls()).toBe(0);
});

test('a new approval cannot be presented as rejected merely because another controller already denied the review', async () => {
  const { controller, service } = controllerFor();
  await controller.start(consent);
  const approval = approvalFor(controller.state.pending!);
  const signal = new AbortController().signal;
  expect(
    await service.decide(
      sourceId,
      { ...approval, decision: 'deny', candidates: [] },
      signal,
    ),
  ).toEqual({ status: 'denied' });
  expect(await service.decide(sourceId, approval, signal)).toEqual({
    status: 'unavailable',
  });
  expect(await rows()).toHaveLength(0);
});

test('typing and clearing an initially absent medication description preserves a valid explicit save', async () => {
  const { controller, synthetic } = controllerFor();
  const generate = synthetic.model.provider.generate.bind(
    synthetic.model.provider,
  );
  synthetic.model.provider.generate = async (...args) => {
    const response = await generate(...args);
    if (!response.ok) return response;
    const value = JSON.parse(response.value.text);
    delete value.value.candidates[0].dosageInstruction;
    return {
      ...response,
      value: { ...response.value, text: JSON.stringify(value) },
    };
  };
  await controller.start(consent);
  expect(
    controller.state.pending?.candidates[0].dosageInstruction,
  ).toBeUndefined();
  controller.edit('candidate-0', 'dosageInstruction', '임시 설명');
  controller.edit('candidate-0', 'dosageInstruction', '');
  await controller.decide('approve');
  expect(controller.state.status).toBe('saved');
  expect(
    (await rows()).find(
      record => record.concept === 'encounter_medication_statement',
    )?.value,
  ).toEqual({ kind: 'text', text: '합성약' });
});
