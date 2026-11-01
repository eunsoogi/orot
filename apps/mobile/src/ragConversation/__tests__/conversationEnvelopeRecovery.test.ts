import { runRagConversationTurn } from '../service';
import type { RagConversationRunOptions } from '../service';
import { createConversationSessions } from '../conversationSessions';
import {
  fixture,
  malformed,
  valid,
  response,
} from '../testSupport/conversationEnvelopeFixtures';

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
