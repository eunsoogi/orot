import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UIDraftFieldLabel as fieldLabel,
  localA2UIDraftPath as path,
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
      { id: 'root', component: 'Column', children: ['body', 'field', 'reset'] },
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
    ],
  }),
];

test('a completed reply owns its local draft', async () => {
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  const model = fixture();
  const store = createConversationSessions();
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
    store.setDraft(1, '이 화면에서 쓸 메모 칸을 주세요.');
    let sending: Promise<void> | undefined;
    await act(async () => {
      sending = store.send(1, (question, previousMessages, signal) =>
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
      await started;
    });
    expect(screen.queryByLabelText(fieldLabel)).toBeNull();
    await act(async () => {
      release(
        response({
          type: 'result',
          value: { answerKind: 'conversation', answer, a2uiFrames: frames },
          citations: [],
        }),
      );
      await sending;
    });
    expect(await screen.findByLabelText(fieldLabel)).toBeTruthy();
    expect(screen.getByText(answer)).toBeTruthy();
    const input = screen.getByLabelText(fieldLabel);
    const lateEdit = input.props.onChangeText as (text: string) => void;
    const text = '합성 사용자 입력';
    await fireEvent.changeText(input, text);
    expect(screen.getByLabelText(fieldLabel).props.value).toBe(text);
    await fireEvent.press(screen.getByRole('button', { name: resetLabel }));
    expect(screen.getByLabelText(fieldLabel).props.value).toBe('');
    expect(model.generate).toHaveBeenCalledTimes(1);
    await view.unmount();
    await act(async () => lateEdit('이전 소유자'));
    expect(screen.queryByLabelText(fieldLabel)).toBeNull();
  } finally {
    store.dispose();
    AppState.currentState = previousAppState;
  }
});
