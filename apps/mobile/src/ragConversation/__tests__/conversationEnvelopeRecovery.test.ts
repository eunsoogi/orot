import { runRagConversationTurn } from '../service';
import type { RagConversationRunOptions } from '../service';
import { createConversationSessions } from '../conversationSessions';
import {
  fixture,
  malformed,
  valid,
  response,
} from '../testSupport/conversationEnvelopeFixtures';

test('a validated partial answer retains its label in the conversation', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: '기록 일부만 확인했어요.',
        completion: 'partial',
      },
      citations: ['synthetic-evidence'],
    }),
  );
  const sessions = createConversationSessions();
  const id = sessions.getSnapshot().activeId;
  sessions.setDraft(id, f.options.question);
  await sessions.send(id, (question, previousMessages, signal) =>
    runRagConversationTurn(
      { ...f.options, question, previousMessages },
      { signal },
    ),
  );
  expect(sessions.getSnapshot().sessions[0]?.messages[1]).toMatchObject({
    completion: 'partial',
    citations: [expect.objectContaining({ evidenceId: 'synthetic-evidence' })],
  });
  sessions.dispose();
});

test('an invalid completion value cannot produce a saved answer', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: '기록',
        completion: 'unfinished',
      },
      citations: ['synthetic-evidence'],
    }),
  );
  const capture = jest.fn();
  expect(
    (
      await runRagConversationTurn({
        ...f.options,
        onValidatedEvidence: capture,
      })
    ).status,
  ).toBe('failure');
  expect(capture).not.toHaveBeenCalled();
});

test('only a validated completed answer publishes its admitted input references', async () => {
  const f = fixture();
  const capture = jest.fn();
  const original = await f.options.loadCurrentEvidence(
    'question',
    new AbortController().signal,
  );
  const item = original.batch.items[0]!;
  const chunk = original.chunks[0]!;
  const other = {
    ...item,
    evidenceId: 'uncited-evidence',
    content: 'Synthetic uncited evidence',
  };
  const otherChunk = {
    ...chunk,
    id: 'other',
    metadata: { ...chunk.metadata, evidenceId: other.evidenceId },
  };
  const input = {
    ...f.options,
    loadCurrentEvidence: async () => ({
      ...original,
      chunks: [chunk, otherChunk],
      batch: {
        ...original.batch,
        items: [item, other],
        coverage: original.batch.coverage.map(coverage => ({
          ...coverage,
          resultLimit: 2,
          returnedCount: 2,
        })),
      },
    }),
    rag: {
      search: jest.fn(
        async () =>
          [
            { chunk, score: 1 },
            { chunk: otherChunk, score: 0.9 },
          ] as never,
      ),
    },
  };
  const outcome = await runRagConversationTurn({
    ...input,
    onValidatedEvidence: capture,
  });
  expect(outcome.status).toBe('answer');
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0]?.[0]).toEqual([
    expect.objectContaining({ evidenceId: 'synthetic-evidence' }),
    expect.objectContaining({ evidenceId: 'uncited-evidence' }),
  ]);
  expect(JSON.stringify(capture.mock.calls[0])).not.toContain(
    'Synthetic evidence',
  );
  f.generate
    .mockReset()
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(malformed());
  capture.mockClear();
  expect(
    (
      await runRagConversationTurn({
        ...input,
        onValidatedEvidence: capture,
      })
    ).status,
  ).toBe('failure');
  expect(capture).not.toHaveBeenCalled();
});

test('repairs only malformed citation shape once and commits the validated answer to history', async () => {
  const f = fixture();
  const sessions = createConversationSessions();
  const id = sessions.getSnapshot().activeId;
  sessions.setDraft(id, f.options.question);
  await sessions.send(id, (question, previousMessages, signal) =>
    runRagConversationTurn(
      { ...f.options, question, previousMessages },
      { signal },
    ),
  );
  expect(f.generate).toHaveBeenCalledTimes(2);
  const session = sessions.getSnapshot().sessions.find(item => item.id === id)!;
  expect(session.messages.map(item => item.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(session.messages[1]?.citations).toHaveLength(1);
  sessions.dispose();
});

test.each([
  ['second malformed', malformed()],
  ['unknown citation', valid(['unknown'])],
  ['duplicate citations', valid(['synthetic-evidence', 'synthetic-evidence'])],
  ['invalid answer', valid(['synthetic-evidence'], '')],
])(
  'rejects %s after the single correction and preserves retry draft',
  async (_name, second) => {
    const f = fixture();
    f.generate
      .mockReset()
      .mockResolvedValueOnce(malformed())
      .mockResolvedValueOnce(second);
    const sessions = createConversationSessions();
    const id = sessions.getSnapshot().activeId;
    sessions.setDraft(id, f.options.question);
    await sessions.send(id, (question, previousMessages, signal) =>
      runRagConversationTurn(
        { ...f.options, question, previousMessages },
        { signal },
      ),
    );
    expect(f.generate).toHaveBeenCalledTimes(2);
    const session = sessions
      .getSnapshot()
      .sessions.find(item => item.id === id)!;
    expect(session.draft).toBe(f.options.question);
    expect(
      session.messages.filter(
        item => item.role === 'assistant' && !item.incomplete,
      ),
    ).toHaveLength(0);
    sessions.dispose();
  },
);

test('does not correct other envelope failures', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(response({ type: 'wrong' }));
  expect(await runRagConversationTurn(f.options)).toMatchObject({
    status: 'failure',
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('retries a failed turn without duplicating it and commits only the recovered answer', async () => {
  const f = fixture();
  f.generate
    .mockReset()
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(valid());
  const sessions = createConversationSessions();
  const id = sessions.getSnapshot().activeId;
  sessions.setDraft(id, f.options.question);
  const send = (
    question: string,
    previousMessages: RagConversationRunOptions['previousMessages'],
    signal?: AbortSignal,
  ) =>
    runRagConversationTurn(
      { ...f.options, question, previousMessages },
      { signal },
    );
  await sessions.send(id, send);
  expect(
    sessions.getSnapshot().sessions.find(item => item.id === id)?.draft,
  ).toBe(f.options.question);
  await sessions.send(id, send);
  const session = sessions.getSnapshot().sessions.find(item => item.id === id)!;
  expect(session.messages.map(item => item.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(f.generate).toHaveBeenCalledTimes(4);
  sessions.dispose();
});
