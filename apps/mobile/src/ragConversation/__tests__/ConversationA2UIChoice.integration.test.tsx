import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import {
  bindLiveConversationA2UILocalDraft,
  conversationA2UILocalDraftFor,
} from '../conversationA2UILocalDraftFrames';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UIChoiceClearLabel as clearLabel,
  localA2UIChoiceLabel as fieldLabel,
  localA2UIChoicePath as path,
  localA2UIChoices as choices,
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

const parts = ['합성 답변 첫 부분', '합성 답변 두 번째 부분'];
const answer = parts.join('\n');
const stamp = 'orot:response:draft';
const frame = (op: string, payload: object) =>
  JSON.stringify({ version: '1.0', [op]: { surfaceId: stamp, ...payload } });
const frames = [
  frame('createSurface', {
    catalogId: conversationA2UICatalog,
    components: [
      { id: 'root', component: 'Column', children: ['body', 'next'] },
      { id: 'body', component: 'Text', text: parts[0] },
      { id: 'next', component: 'Text', text: parts[1] },
    ],
  }),
  frame('updateDataModel', { path, value: [] }),
  frame('updateComponents', {
    components: [
      { id: 'root', component: 'Column', children: ['body', 'next', 'field'] },
      {
        id: 'field',
        component: 'ChoicePicker',
        label: fieldLabel,
        variant: 'mutuallyExclusive',
        options: choices,
        value: { '@path': path },
      },
    ],
  }),
];

const unsafe = frames.map((originalFrame, index) =>
  index === 2
    ? originalFrame.replace(
        '"component":"ChoicePicker"',
        '"component":"ChoicePicker","action":{"event":{"name":"save"}}',
      )
    : originalFrame,
);

test.each([
  { label: 'owned final choice', resultFrames: frames, accepted: true },
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
        store.setDraft(1, '이 답변 두 부분에 임시 선택을 넣어 주세요.');
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
      expect(screen.queryByText(fieldLabel)).toBeNull();
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
      for (const part of parts)
        expect(screen.getByText(part, { exact: false })).toBeTruthy();
      if (!accepted) {
        expect(settledRoot).toBeUndefined();
        expect(screen.queryByText(fieldLabel)).toBeNull();
        expect(model.generate).toHaveBeenCalledTimes(1);
        await view.unmount();
        return;
      }
      expect(settledRoot).toBeDefined();
      expect(conversationA2UILocalDraftFor(settledRoot!)).toEqual({
        fieldId: 'field',
        kind: 'choice',
      });
      expect(await screen.findByText(fieldLabel)).toBeTruthy();
      const radio = (index: number) =>
        screen.getByRole('radio', { name: choices[index].label });
      const clear = () => screen.getByRole('button', { name: clearLabel });
      const checked = (first: boolean, second: boolean) => {
        expect(radio(0)).toHaveProp('accessibilityState', { checked: first });
        expect(radio(1)).toHaveProp('accessibilityState', { checked: second });
      };
      checked(false, false);
      expect(clear()).toBeDisabled();
      await fireEvent.press(radio(0));
      checked(true, false);
      await fireEvent.press(radio(1));
      checked(false, true);
      await fireEvent.press(clear());
      checked(false, false);
      await fireEvent.press(radio(1));
      await view.unmount();
      expect(screen.queryByText(fieldLabel)).toBeNull();
      const replacement = await render(<Scene />);
      try {
        await screen.findByText(fieldLabel);
        checked(false, false);
        await fireEvent.press(radio(0));
        checked(true, false);
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

test('temporary choice admits only its enum and retires a captured owner', () => {
  const root = bindLiveConversationA2UILocalDraft(
    {
      id: 'root',
      component: 'Column',
      children: [
        { id: 'body', component: 'Text', variant: 'body', text: parts[0] },
      ],
    },
    { fieldId: 'field', kind: 'choice' },
  );
  const approved = conversationA2UILocalDraftFor(root);
  if (approved?.kind !== 'choice')
    throw new Error('Expected a validated local choice plan.');
  const first = mountConversationA2UILocalDraft(
    approved,
    'orot:1:12',
    () => true,
  );
  if (!first) throw new Error('The first choice did not mount.');
  const lateChange = first.change;
  expect(lateChange(approved.fieldId, 'unapproved')).toBe(false);
  expect(lateChange(approved.fieldId, 'first')).toBe(true);
  first.retire();

  const replacement = mountConversationA2UILocalDraft(
    approved,
    'orot:1:12',
    () => true,
  );
  if (!replacement) throw new Error('The replacement choice did not mount.');
  expect(replacement.read(approved.fieldId)).toBe('');
  expect(lateChange(approved.fieldId, 'first')).toBe(false);
  expect(replacement.read(approved.fieldId)).toBe('');
  expect(replacement.change(approved.fieldId, 'second')).toBe(true);
  expect(replacement.read(approved.fieldId)).toBe('second');
  replacement.retire();
});
