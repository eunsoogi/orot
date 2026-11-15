import { mayContinuePastOptionalReview } from '../coldOptionalReviewBoundary';
const boundary = {
  phase: 'revised_response',
  awaitingAuthorization: 'model-2',
  pendingOperation: false,
  terminal: false,
};
const review = {
  operation_id: 'model-1:call-2',
  status: 'pending',
  purpose: 'preview_review',
};
test('only an earlier optional reviewer may remain pending', () => {
  expect(
    mayContinuePastOptionalReview(JSON.stringify(boundary), [review]),
  ).toBe(true);
  for (const row of [
    { ...review, purpose: null },
    { ...review, status: 'invalidated' },
    { ...review, operation_id: 'model-2:call-1' },
    { ...review, operation_id: 'model-3:call-1' },
    { ...review, operation_id: 'tool-1' },
    { ...review, operation_id: 'model-9007199254740993:call-1' },
  ])
    expect(
      mayContinuePastOptionalReview(JSON.stringify(boundary), [review, row]),
    ).toBe(false);
});
test('no unknown, dispatched, terminal or original review boundary is eligible', () => {
  for (const value of [
    undefined,
    '{',
    JSON.stringify(null),
    JSON.stringify({}),
    ...[
      { phase: 'task_response' },
      { pendingOperation: true },
      { terminal: true },
      { awaitingAuthorization: 'model-1' },
      { awaitingAuthorization: 'tool-2' },
    ].map(patch => JSON.stringify({ ...boundary, ...patch })),
  ])
    expect(mayContinuePastOptionalReview(value, [review])).toBe(false);
});
