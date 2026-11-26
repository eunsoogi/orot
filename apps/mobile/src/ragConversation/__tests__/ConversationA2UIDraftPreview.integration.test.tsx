import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { projectConversationDraftPreview } from '../conversationA2UIDraftPreviewWire';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UIDraftFieldLabel as fieldLabel,
  localA2UIDraftPath as path,
  localA2UIDraftPreviewLabel as previewLabel,
  localA2UIDraftResetAction as name,
  localA2UIDraftResetLabel as resetLabel,
} from '../conversationA2UILocalDraft';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const answer = '합성 대화 답변';
const stamp = 'orot:response:draft';
const frame = (op: string, payload: object) =>
  JSON.stringify({ version: '1.0', [op]: { surfaceId: stamp, ...payload } });
const frames = [
  frame('createSurface', {
    catalogId: conversationA2UICatalog,
    components: [
      { id: 'root', component: 'Column', children: ['body'] },
      { id: 'body', component: 'Text', text: answer },
    ],
  }),
  frame('updateDataModel', { path, value: '' }),
  frame('updateComponents', {
    components: [
      {
        id: 'root',
        component: 'Column',
        children: ['body', 'field', 'reset', 'preview'],
      },
      {
        id: 'field',
        component: 'TextField',
        label: fieldLabel,
        variant: 'shortText',
        value: { '@path': path },
      },
      {
        id: 'reset',
        component: 'Button',
        child: 'label',
        action: { event: { name, context: {} } },
      },
      { id: 'label', component: 'Text', text: resetLabel },
      { id: 'preview', component: 'Text', text: { '@path': path } },
    ],
  }),
];

test('v42 rejects a reactive draft preview while preserving the accepted answer', () => {
  const previous = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '42',
  });
  if (!previous) throw new Error('Expected v42 contract.');
  const input = {
    request: '메모 칸을 주세요.',
    evidence: { items: [], coverage: [], conflicts: [] },
    context: [],
  } as Parameters<typeof previous.validateResult>[1];
  const result = previous.validateResult(
    { answerKind: 'conversation', answer, a2uiFrames: frames },
    input,
  );
  expect(result).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

test.each(['foreign path', 'alias', 'user action'] as const)(
  'rejects %s rather than permitting a new preview sink',
  outcome => {
    const last = frames[2];
    const malicious =
      outcome === 'foreign path'
        ? last.replace(
            '"id":"preview","component":"Text","text":{"@path":"/local/draft"}',
            '"id":"preview","component":"Text","text":{"@path":"/currentConversation"}',
          )
        : outcome === 'alias'
          ? last
              .replace(
                '"id":"preview","component":"Text"',
                '"id":"body","component":"Text"',
              )
              .replace('"reset","preview"', '"reset","body"')
          : last.replace(
              '"id":"preview","component":"Text"',
              '"id":"preview","component":"Text","action":{"event":{"name":"publish"}}',
            );
    expect(
      projectConversationDraftPreview([...frames.slice(0, 2), malicious]),
    ).toBeUndefined();
  },
);

test('the actual live scratch field reacts on edit and reset, never becoming answer prose', async () => {
  const oldPhase = AppState.currentState;
  AppState.currentState = 'active';
  const model = fixture();
  const store = createConversationSessions();
  model.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer, a2uiFrames: frames },
      citations: [],
    }),
  );
  function Scene() {
    const snapshot = useConversationPresentationSnapshot(store);
    const session = snapshot.sessions.find(
      item => item.id === snapshot.activeId,
    )!;
    const owner = useConversationA2UILocalDraftOwner(store, session.id);
    return (
      <ConversationA2UILocalDraftOwner.Provider value={owner}>
        <ConversationTranscriptMessages
          messages={session.messages}
          instructions={undefined}
          replyFocus={undefined}
          onLayout={jest.fn()}
          messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
        />
      </ConversationA2UILocalDraftOwner.Provider>
    );
  }
  try {
    const view = await render(<Scene />);
    try {
      expect(screen.queryByLabelText(previewLabel)).toBeNull();
      await act(async () => {
        store.setDraft(1, '이 화면에서만 메모 미리보기를 보고 싶어요.');
        await store.send(1, (question, previousMessages, signal) =>
          runRagConversationTurn(
            {
              ...model.options,
              question,
              previousMessages,
              loadCurrentEvidence: async () => ({
                batch: { items: [], coverage: [], conflicts: [] },
                chunks: [],
              }),
            },
            { signal },
          ),
        );
      });
      const input = () => screen.getByLabelText(fieldLabel);
      const preview = () => screen.getByTestId('a2ui-local-draft-preview');
      const text = '합성 임시 문장입니다.';
      expect(screen.getByLabelText(previewLabel)).toBeTruthy();
      expect(preview()).toBeEmptyElement();
      await fireEvent.changeText(input(), text);
      expect(preview()).toHaveTextContent(text, { exact: true });
      expect(store.getSnapshot().sessions[0]?.messages.at(-1)?.content).toBe(
        answer,
      );
      await fireEvent.press(screen.getByRole('button', { name: resetLabel }));
      expect(preview()).toBeEmptyElement();
      await fireEvent.changeText(input(), text);
    } finally {
      await view.unmount();
    }
    const reopened = await render(<Scene />);
    try {
      expect(screen.getByTestId('a2ui-local-draft-preview')).toBeEmptyElement();
      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      await reopened.unmount();
    }
  } finally {
    store.dispose();
    AppState.currentState = oldPhase;
  }
});
