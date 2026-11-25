import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import {
  bindLiveConversationA2UILocalDraft,
  conversationA2UILocalDraftFor,
} from '../conversationA2UILocalDraftFrames';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UICheckLabel as fieldLabel,
  localA2UICheckPath as path,
  mountConversationA2UILocalDraft,
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

const unsafe = frames.map((originalFrame, index) =>
  index === 2
    ? originalFrame.replace(
        '"component":"CheckBox"',
        '"component":"CheckBox","action":{"event":{"name":"save"}}',
      )
    : originalFrame,
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
      let sending: Promise<void> | undefined;
      await act(async () => {
        store.setDraft(1, '이 답변에 임시 확인란을 넣어 주세요.');
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
      expect(control.props.value).toBe(false);
      await fireEvent(control, 'valueChange', true);
      expect(screen.getByLabelText(fieldLabel).props.value).toBe(true);
      await fireEvent(screen.getByLabelText(fieldLabel), 'valueChange', false);
      expect(screen.getByLabelText(fieldLabel).props.value).toBe(false);
      await fireEvent(screen.getByLabelText(fieldLabel), 'valueChange', true);
      expect(screen.getByLabelText(fieldLabel).props.value).toBe(true);
      expect(model.generate).toHaveBeenCalledTimes(1);
      await view.unmount();
      expect(screen.queryByLabelText(fieldLabel)).toBeNull();

      // Remounting the same answer starts with a fresh, unchecked control.
      const replacement = await render(<Scene />);
      try {
        expect((await screen.findByLabelText(fieldLabel)).props.value).toBe(
          false,
        );
        await fireEvent(screen.getByLabelText(fieldLabel), 'valueChange', true);
        expect(screen.getByLabelText(fieldLabel).props.value).toBe(true);
        expect(model.generate).toHaveBeenCalledTimes(1);
      } finally {
        await replacement.unmount();
      }
    } finally {
      store.dispose();
      AppState.currentState = previousAppState;
    }
  },
);

test('retiring an owned checkbox rejects a captured change after replacement', () => {
  const root = bindLiveConversationA2UILocalDraft(
    {
      id: 'root',
      component: 'Column',
      children: [
        { id: 'body', component: 'Text', variant: 'body', text: answer },
      ],
    },
    { fieldId: 'field', kind: 'checkbox' },
  );
  const approved = conversationA2UILocalDraftFor(root);
  if (approved?.kind !== 'checkbox')
    throw new Error('Expected the validated local checkbox plan.');
  const surfaceId = 'orot:1:12';
  const first = mountConversationA2UILocalDraft(
    approved,
    surfaceId,
    () => true,
  );
  if (!first) throw new Error('The first checkbox did not mount.');
  const lateChange = first.change;
  expect(lateChange(approved.fieldId, true)).toBe(true);
  first.retire();

  const replacement = mountConversationA2UILocalDraft(
    approved,
    surfaceId,
    () => true,
  );
  if (!replacement) throw new Error('The replacement checkbox did not mount.');
  expect(replacement.read(approved.fieldId)).toBe(false);
  expect(lateChange(approved.fieldId, true)).toBe(false);
  expect(replacement.read(approved.fieldId)).toBe(false);
  expect(replacement.change(approved.fieldId, true)).toBe(true);
  expect(replacement.read(approved.fieldId)).toBe(true);
  replacement.retire();
});
