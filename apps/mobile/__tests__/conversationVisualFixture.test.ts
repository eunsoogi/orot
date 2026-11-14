import {
  sendSyntheticConversation,
  syntheticConversationAnswer,
} from '../e2e/conversationVisualFixture';

test('local completed output keeps its streamed text and explicit synthetic citation', async () => {
  const onTaskStreamEvent = jest.fn();
  const result = await sendSyntheticConversation(
    'complete synthetic',
    [],
    new AbortController().signal,
    { onTaskStreamEvent },
  );
  expect(onTaskStreamEvent).toHaveBeenLastCalledWith({
    type: 'text_delta',
    text: syntheticConversationAnswer,
  });
  expect(result).toMatchObject({
    status: 'answer',
    answer: syntheticConversationAnswer,
    citations: [expect.objectContaining({ sourceKind: 'personal_record' })],
  });
});

test.each(['pending synthetic', 'Pending synthetic', 'PENDING SYNTHETIC'])(
  'pending control %s waits for actual cancellation rather than a fixture timer',
  async question => {
    const controller = new AbortController();
    let settled = false;
    const pending = sendSyntheticConversation(
      question,
      [],
      controller.signal,
    ).then(result => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).resolves.toEqual({ status: 'unavailable' });
  },
);

test.each(['failure synthetic', 'Failure synthetic', 'FAILURE SYNTHETIC'])(
  'failure control %s has no successful text or citation event',
  async question => {
    const onTaskStreamEvent = jest.fn();
    await expect(
      sendSyntheticConversation(question, [], undefined, {
        onTaskStreamEvent,
      }),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(onTaskStreamEvent).not.toHaveBeenCalled();
  },
);

test('synthetic summary demonstrates failure and per-card retry without provider execution', async () => {
  const outcome = await sendSyntheticConversation(
    'summary-probe',
    [],
    new AbortController().signal,
  );
  if (
    outcome.status !== 'answer' ||
    !outcome.healthSummary ||
    !outcome.retryHealthSummary
  )
    throw new Error('Expected synthetic summary');
  expect(outcome.healthSummary.analysis).toMatchObject({
    incompleteEvidence: true,
    omittedUnsupportedContent: true,
    savedSummary: { status: 'failed' },
  });
  expect(await outcome.retryHealthSummary()).toMatchObject({
    reference: outcome.healthSummary.reference,
    analysis: { savedSummary: { status: 'saved' } },
  });
});

// An already-cancelled native request must not wait for another abort event.
test.each(['pending', 'Pending', 'PENDING'])(
  'already-aborted %s settles unavailable',
  async question => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sendSyntheticConversation(question, [], controller.signal),
    ).resolves.toEqual({ status: 'unavailable' });
  },
);
