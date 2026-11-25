import { render, screen, within } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const emptyEvidence = { items: [], coverage: [], conflicts: [] };
const draft = 'orot:response:draft';
const fruits = ['사과', '배'];
const answer = fruits.join('\n');
function frame(op: string, payload: object, surfaceId = draft) {
  return JSON.stringify({ version: '1.0', [op]: { surfaceId, ...payload } });
}
const create = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [{ id: 'root', component: 'Card', child: 'items' }],
});
const update = frame('updateComponents', {
  components: [
    { id: 'items', component: 'List', children: ['first', 'second'] },
    { id: 'first', component: 'Text', text: { '@path': '/fruit/first' } },
    { id: 'second', component: 'Text', text: { '@path': '/fruit/second' } },
  ],
});
const data = frame('updateDataModel', {
  path: '/fruit',
  value: { first: fruits[0], second: fruits[1] },
});
const revised = frame('updateDataModel', {
  path: '/fruit/first',
  value: '새로운 문구',
});
const deleted = frame('deleteSurface', {});
const valid = [create, update, data];

test.each([
  ['model sends no surface', []],
  ['pending reference never resolves', [create, update]],
  ['delete before commitment', [...valid, deleted]],
  ['no resurrection after delete', [...valid, deleted, create, update, data]],
  [
    'updates another surface',
    [...valid, frame('deleteSurface', {}, 'orot:other:turn')],
  ],
  ['contains unvalidated revised prose', [...valid, revised]],
  ['requires genuine first create', [update, create, data]],
  ['unknown frame rolls back staged changes', [...valid, frame('callTool', {})]],
  ['malformed frame after valid frames', [...valid, '{']],
  ['over operation budget', [...valid, ...Array<string>(12).fill(data)]],
] as const)('uses plain text if %s', (_name, frames) => {
  expect(acceptConversationA2UIFrameSequence(frames, answer)).toBeUndefined();
});

test('archives a completed line layout without storing frames or separate prose', () => {
  const root = acceptConversationA2UIFrameSequence(valid, answer);
  expect(root).toBeDefined();
  const archived = storeConversationA2UILayout(root!, answer);
  expect(archived).toEqual({ version: 2, tree: ['Card', ['List', 0, 0]] });
  expect(restoreConversationA2UILayout(archived, answer)).toMatchObject({
    component: 'Card',
    children: [
      { component: 'List', children: fruits.map(text => ({ text })) },
    ],
  });
  expect(
    restoreConversationA2UILayout({ ...archived, version: 1 }, answer),
  ).toBeUndefined();
});

test('only the completed owning transcript bubble receives the final tree', async () => {
  const model = fixture();
  let release!: (result: ReturnType<typeof response>) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => {
    began = resolve;
  });
  model.generate.mockReset().mockImplementationOnce(() => {
    began();
    return new Promise<ReturnType<typeof response>>(resolve => {
      release = resolve;
    });
  });
  const sessions = createConversationSessions();
  const transcript = () => (
    <ConversationTranscriptMessages
      messages={sessions.getSnapshot().sessions[0]!.messages}
      instructions={undefined}
      replyFocus={undefined}
      onLayout={jest.fn()}
      messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
    />
  );
  const send = () =>
    sessions.send(1, (question, previousMessages, signal) =>
      runRagConversationTurn(
        {
          ...model.options,
          question,
          previousMessages,
          loadCurrentEvidence: async () => ({
            batch: emptyEvidence,
            chunks: [],
          }),
        },
        { signal },
      ),
    );
  const result = (body: string, a2uiFrames: readonly string[]) =>
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer: body, a2uiFrames },
      citations: [],
    });
  try {
    sessions.setDraft(1, '과일 예시를 보여 주세요.');
    const first = send();
    await started;
    const view = await render(transcript());
    expect(screen.queryByText(fruits[0]!)).toBeNull();
    release(result(answer, valid));
    await first;
    await view.rerender(transcript());
    const root = within(screen.getByTestId('rag-conversation-answer-body'));
    for (const fruit of fruits)
      expect(root.getByText(fruit).props.allowFontScaling).toBe(true);
    expect(root.queryAllByRole('button')).toHaveLength(0);
    expect(root.queryByText(answer)).toBeNull();

    const otherAnswer = '수박\n자두';
    model.generate.mockResolvedValueOnce(result(otherAnswer, valid));
    sessions.setDraft(1, '다른 예시를 두 가지 보여 주세요.');
    await send();
    await view.rerender(transcript());
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(fruits[0]!)).toHaveLength(1);
    expect(screen.getByText(otherAnswer)).toBeTruthy();

    let cancelledStarted!: () => void;
    let releaseCancelled!: (value: ReturnType<typeof response>) => void;
    const cancelledModel = new Promise<void>(resolve => {
      cancelledStarted = resolve;
    });
    model.generate.mockImplementationOnce(() => {
      cancelledStarted();
      return new Promise<ReturnType<typeof response>>(resolve => {
        releaseCancelled = resolve;
      });
    });
    sessions.setDraft(1, '다른 과일도 보여 주세요.');
    const cancelled = send();
    await cancelledModel;
    sessions.cancel(1);
    releaseCancelled(result('새로운 문구\n배', [...valid, revised]));
    await cancelled;
    await view.rerender(transcript());
    expect(screen.queryByText('새로운 문구')).toBeNull();
    expect(screen.getAllByText(fruits[0]!)).toHaveLength(1);
  } finally {
    sessions.dispose();
  }
});
