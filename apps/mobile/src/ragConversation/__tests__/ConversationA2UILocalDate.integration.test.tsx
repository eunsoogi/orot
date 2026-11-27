import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View };
});
const answer = '읽기 쉬운 짧은 글로 시작해 봐요.';
const input = {
  request: '가상의 독서 주간을 보기 좋게 정리해 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];
const date = {
  id: 'date',
  component: 'DateTimeInput',
  label: '독서할 날',
  enableDate: true,
  min: '2035-06-01',
  max: '2035-06-07',
  value: { '@path': '/form/reading/day' },
};
function proposal(changes: Record<string, unknown> = {}, seed?: object) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Card', child: 'group' },
          { id: 'group', component: 'Column', children: ['date', 'prose'] },
          { id: 'prose', component: 'Text', text: answer },
          { ...date, ...changes },
        ],
      }),
      ...(seed ? [frame('updateDataModel', seed)] : []),
    ],
  };
}

test('the mounted date-only picker stays blank until a valid local gesture and resets on retirement', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid') throw new Error('Expected ordinary answer');
  const root = result.value.a2uiPresentation;
  expect(root?.component).toBe('Card');
  let active = true;
  let notify: (() => void) | undefined;
  const view = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: () => (active ? 'synthetic:reading-date' : undefined),
        subscribe(listener) {
          notify = listener;
          return () => {};
        },
      }}
    >
      <ConversationMessageText
        content={answer}
        user={false}
        verifiedA2UI={root}
      />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  const opener = () => screen.getByRole('button', { name: /독서할 날/ });
  expect(opener()).toHaveTextContent('날짜 선택');
  await fireEvent.press(opener());
  const picker = screen.getByTestId('conversation-a2ui-local-date-picker');
  expect(picker).toHaveProp('mode', 'date');
  expect(picker).toHaveProp('timeZoneName', 'UTC');
  expect(picker).toHaveProp('minimumDate', new Date('2035-06-01T00:00:00Z'));
  await fireEvent(picker, 'valueChange', {}, new Date('2035-06-08T01:00:00Z'));
  expect(opener()).toHaveTextContent('날짜 선택');
  await fireEvent(picker, 'valueChange', {}, new Date('2035-06-04T23:00:00Z'));
  expect(opener()).toHaveTextContent('날짜 선택');
  const confirm = () => screen.getByRole('button', { name: '이 날짜 선택' });
  await fireEvent.press(confirm());
  expect(opener()).toHaveTextContent('2035-06-04');
  expect(root && storeConversationA2UILayout(root, answer)).toBeUndefined();
  const late: unknown = picker.props.onValueChange;
  if (typeof late !== 'function') throw new Error('Missing native callback');
  await fireEvent.press(opener());
  await act(() => late({}, new Date('2035-06-07T00:00:00Z')));
  await fireEvent.press(confirm());
  expect(opener()).toHaveTextContent('2035-06-04');
  await act(() => {
    active = false;
    notify?.();
    late({}, new Date('2035-06-07T00:00:00Z'));
  });
  expect(screen.queryByRole('button', { name: /독서할 날/ })).toBeNull();
  expect(screen.getByText(answer)).toBeVisible();
  await act(() => {
    active = true;
    notify?.();
  });
  expect(opener()).toHaveTextContent('날짜 선택');
  expect(
    screen.queryByTestId('conversation-a2ui-local-date-picker'),
  ).toBeNull();
  await fireEvent.press(opener());
  await fireEvent.press(confirm());
  expect(opener()).toHaveTextContent('2035-06-01');
  await view.unmount();
});

test.each([
  proposal({ enableTime: true }),
  proposal({ enableDate: false }),
  proposal({ value: '2035-06-03' }),
  proposal({ max: '2034-06-02' }),
  proposal({ min: '2035-02-29' }),
  proposal({ max: { '@path': '/form/bound' } }),
  proposal({ action: { event: { name: 'schedule' } } }),
  proposal({}, { path: '/form/reading', value: { day: '2035-06-03' } }),
])(
  'unsupported bounds, a model value or scheduling action fall back to exact prose',
  request => {
    expect(ragConversationTask.validateResult(request, input)).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer },
    });
  },
);

test('the historical v46 does not admit freshly available date controls', () => {
  const v46 =
    restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: '46',
    }) ??
    (ragConversationTask.taskVersion === '46'
      ? ragConversationTask
      : undefined);
  expect(v46?.validateResult(proposal(), input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

const timeOnly = {
  label: '가상 독서 시간',
  enableDate: false,
  enableTime: true,
  min: undefined,
  max: undefined,
  value: { '@path': '/form/practice/time' },
};

test('the mounted time-only field keeps wall-clock time local until confirmation', async () => {
  const accepted = ragConversationTask.validateResult(
    proposal(timeOnly),
    input,
  );
  if (accepted.status !== 'valid' || !accepted.value.a2uiPresentation)
    throw new Error('Expected the pinned time-only DateTimeInput');
  const root = accepted.value.a2uiPresentation;
  let active = true;
  let notify: (() => void) | undefined;
  const ui = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: candidate =>
          active && candidate === root ? 'synthetic:time-only' : undefined,
        subscribe(listener) {
          notify = listener;
          return () => {};
        },
      }}
    >
      <ConversationMessageText
        content={answer}
        user={false}
        verifiedA2UI={root}
      />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  const opener = () => screen.getByRole('button', { name: /가상 독서 시간/ });
  expect(opener()).toHaveTextContent('시간 선택');
  await fireEvent.press(opener());
  const picker = screen.getByTestId('conversation-a2ui-local-time-picker');
  expect(picker).toHaveProp('mode', 'time');
  expect(picker).toHaveProp('timeZoneName', 'UTC');
  expect(picker.props.minimumDate).toBeUndefined();
  await fireEvent(
    picker,
    'valueChange',
    {},
    new Date('2046-02-03T16:47:59.000Z'),
  );
  expect(opener()).toHaveTextContent('시간 선택');
  await fireEvent.press(screen.getByRole('button', { name: '이 시간 선택' }));
  expect(opener()).toHaveTextContent('16:47');
  expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
  await act(() => {
    active = false;
    notify?.();
  });
  expect(screen.queryByRole('button', { name: /가상 독서 시간/ })).toBeNull();
  expect(screen.getByText(answer)).toBeVisible();
  await act(() => {
    active = true;
    notify?.();
  });
  expect(opener()).toHaveTextContent('시간 선택');
  await ui.unmount();
});

test('time-only rejects published-but-unsupported options and remains closed in the older contract', () => {
  const legacy = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '54',
  });
  const fallback = {
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  };
  expect(legacy?.validateResult(proposal(timeOnly), input)).toEqual(fallback);
  for (const invalid of [
    proposal({ ...timeOnly, min: '08:00:00Z' }),
    proposal({ ...timeOnly, value: '08:00' }),
    proposal(timeOnly, { path: '/form/practice', value: { time: '08:00' } }),
    proposal({ ...timeOnly, action: { event: { name: 'schedule' } } }),
  ])
    expect(ragConversationTask.validateResult(invalid, input)).toEqual(
      fallback,
    );
});
