import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

jest.mock('@react-native-community/slider', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View };
});

const answer = '시간을 나누면 읽을 부분을 정하기 쉬워요.';
const input = {
  request: '가상 독서 계획을 한눈에 정리해 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];
const slider = {
  id: 'minutes',
  component: 'Slider',
  label: '하루에 읽을 시간',
  min: 10,
  max: 60,
  steps: 5,
  value: { '@path': '/form/reading/time' },
};
function proposal(changes: Record<string, unknown> = {}, seed?: number) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Card', child: 'group' },
          {
            id: 'group',
            component: 'Column',
            children: ['minutes', 'blurb', 'ready'],
          },
          { id: 'blurb', component: 'Text', text: answer },
          {
            id: 'ready',
            component: 'CheckBox',
            label: '준비됨',
            value: { '@path': '/form/reading/ready' },
          },
          { ...slider, ...changes },
        ],
      }),
      ...(seed === undefined
        ? []
        : [
            frame('updateDataModel', {
              path: '/form/reading/time',
              value: seed,
            }),
          ]),
    ],
  };
}

test('a model-composed range displays alongside another local control and retires its ephemeral value', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid')
    throw new Error('Expected valid accepted prose');
  const root = result.value.a2uiPresentation;
  expect(root?.component).toBe('Card');
  let active = true;
  let notify: (() => void) | undefined;
  const owner = {
    surface: () => (active ? 'synthetic:reading' : undefined),
    subscribe(listener: () => void) {
      notify = listener;
      return () => {};
    },
  };
  const view = await render(
    <ConversationA2UILocalDraftOwner.Provider value={owner}>
      <ConversationMessageText
        content={answer}
        user={false}
        verifiedA2UI={root}
      />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  const control = () =>
    screen.getByRole('adjustable', { name: '하루에 읽을 시간' });
  expect(control()).toHaveProp('accessibilityValue', {
    min: 10,
    max: 60,
    now: 10,
  });
  await fireEvent(control(), 'valueChange', 30);
  expect(control()).toHaveProp('accessibilityValue', {
    min: 10,
    max: 60,
    now: 30,
  });
  await fireEvent(control(), 'valueChange', Infinity);
  await fireEvent(control(), 'valueChange', 99);
  expect(control()).toHaveProp('accessibilityValue', {
    min: 10,
    max: 60,
    now: 30,
  });
  expect(screen.getByLabelText('준비됨')).toHaveProp('value', false);
  expect(root && storeConversationA2UILayout(root, answer)).toBeUndefined();
  const late: unknown = control().props.onValueChange;
  if (typeof late !== 'function')
    throw new Error('Fixture must retain the previous native callback');
  await act(() => {
    active = false;
    notify?.();
    late(40);
  });
  expect(screen.queryByRole('adjustable')).toBeNull();
  expect(screen.getByText(answer)).toBeVisible();
  await act(() => {
    active = true;
    notify?.();
    late(50);
  });
  expect(control()).toHaveProp('accessibilityValue', {
    min: 10,
    max: 60,
    now: 10,
  });
  await view.unmount();
});

const neutral = proposal();
const seededParent = {
  ...neutral,
  a2uiFrames: [
    ...neutral.a2uiFrames,
    frame('updateDataModel', { path: '/form/reading', value: { time: 30 } }),
  ],
};
const seededSurface = {
  ...neutral,
  a2uiFrames: [
    JSON.stringify(
      (() => {
        const create = JSON.parse(neutral.a2uiFrames[0]!);
        create.createSurface.dataModel = { form: { reading: { time: 30 } } };
        return create;
      })(),
    ),
  ],
};

test.each([
  proposal({ max: 9 }),
  proposal({ steps: 101 }),
  proposal({ min: null }),
  proposal({ value: 30 }),
  proposal({ value: { '@path': '/form/reading/ready' } }),
  proposal({ action: { event: { name: 'send' } } }),
  proposal({}, 30),
  seededParent,
  seededSurface,
])(
  'invalid numeric bounds, shared binding, actions or prefill use exact ordinary prose',
  value => {
    expect(ragConversationTask.validateResult(value, input)).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer },
    });
  },
);

test('a restored v45 cannot borrow the fresh slider grammar', () => {
  const v45 = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '45',
  });
  expect(v45?.validateResult(proposal(), input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});
