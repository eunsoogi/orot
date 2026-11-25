import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UILocalDraftFor } from '../conversationA2UILocalDraftFrames';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UICheckLabel as fieldLabel,
  localA2UICheckPath as path,
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
  frame('updateDataModel', { path, value: false }),
  frame('updateComponents', {
    components: [
      { id: 'root', component: 'Column', children: ['body', 'field'] },
      {
        id: 'field',
        component: 'CheckBox',
        label: fieldLabel,
        value: { '@path': path },
      },
    ],
  }),
];

const unsafe = frames.map((frame, index) =>
  index === 2
    ? frame.replace(
        '"component":"CheckBox"',
        '"component":"CheckBox","action":{"event":{"name":"save"}}',
      )
    : frame,
);

test.each([
  { label: 'owned final checkbox', resultFrames: frames, accepted: true },
  { label: 'unapproved action', resultFrames: unsafe, accepted: false },
])(
  'a completed reply exposes only its $label',
  async ({ resultFrames, accepted }) => {
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
      store.setDraft(1, '이 답변에 임시 확인란을 넣어 주세요.');
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
            value: {
              answerKind: 'conversation',
              answer,
              a2uiFrames: resultFrames,
            },
            citations: [],
          }),
        );
        await sending;
      });
      const settled = store.getSnapshot().sessions[0]!;
      const settledRoot = settled.messages.at(-1)?.a2uiPresentation;
      expect(settled.busy).toBe(false);
      expect(screen.getByText(answer)).toBeTruthy();
      if (!accepted) {
        expect(settledRoot).toBeUndefined();
        expect(screen.queryByLabelText(fieldLabel)).toBeNull();
        expect(model.generate).toHaveBeenCalledTimes(1);
        await view.unmount();
        return;
      }
      expect(settledRoot).toBeDefined();
      expect(conversationA2UILocalDraftFor(settledRoot!)).toEqual({
        fieldId: 'field',
        kind: 'checkbox',
      });
      expect(await screen.findByLabelText(fieldLabel)).toBeTruthy();
      const control = screen.getByLabelText(fieldLabel);
      const lateChange = control.props.onValueChange as (
        value: boolean,
      ) => void;
      expect(control.props.value).toBe(false);
      await fireEvent(control, 'valueChange', true);
      expect(screen.getByLabelText(fieldLabel).props.value).toBe(true);
      await fireEvent(screen.getByLabelText(fieldLabel), 'valueChange', false);
      expect(screen.getByLabelText(fieldLabel).props.value).toBe(false);
      expect(model.generate).toHaveBeenCalledTimes(1);
      await view.unmount();
      await act(async () => lateChange(true));
      expect(screen.queryByLabelText(fieldLabel)).toBeNull();
    } finally {
      store.dispose();
      AppState.currentState = previousAppState;
    }
  },
);
