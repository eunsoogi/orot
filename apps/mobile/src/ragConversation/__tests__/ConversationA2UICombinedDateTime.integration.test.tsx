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

const combined = {
  label: '가상 독서 날짜와 시간',
  enableDate: true,
  enableTime: true,
  min: '2035-06-01T10:00:00+09:00',
  max: '2035-06-07T01:00:00Z',
};

test('the current ordinary response mounts one combined native picker with exact instant bounds and owner retirement', async () => {
  const result = ragConversationTask.validateResult(proposal(combined), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected admitted combined DateTimeInput');
  const root = result.value.a2uiPresentation;
  let active = true;
  let notify: (() => void) | undefined;
  const ui = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: node =>
          active && node === root ? 'synthetic:combined' : undefined,
        subscribe(listener) {
          notify = listener;
          return () => {
            notify = undefined;
          };
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
  const opener = () =>
    screen.getByRole('button', { name: /가상 독서 날짜와 시간/ });
  const picker = () =>
    screen.getByTestId('conversation-a2ui-local-datetime-picker');
  const confirm = () =>
    screen.getByRole('button', { name: '이 날짜와 시간 선택' });
  const value = new Date('2035-06-04T23:42:00Z');
  try {
    expect(opener()).toHaveTextContent('날짜와 시간 선택');
    await fireEvent.press(opener());
    expect(picker()).toHaveProp('mode', 'datetime');
    expect(picker()).toHaveProp(
      'minimumDate',
      new Date('2035-06-01T01:00:00Z'),
    );
    expect(picker()).toHaveProp('maximumDate', new Date(combined.max));
    await fireEvent(picker(), 'valueChange', {}, value);
    expect(opener()).toHaveTextContent('날짜와 시간 선택');
    await fireEvent(
      picker(),
      'valueChange',
      {},
      new Date('2035-06-07T01:01:00Z'),
    );
    expect(picker()).toHaveProp('value', value);
    const late: unknown = picker().props.onValueChange;
    if (typeof late !== 'function')
      throw new Error('Missing picker event handler');
    await fireEvent.press(confirm());
    expect(opener()).toHaveTextContent(
      value.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    );
    await fireEvent.press(opener());
    await act(() => late({}, new Date(combined.max)));
    expect(picker()).toHaveProp('value', value);
    expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
    expect(result.value.answer).toBe(answer);
    await act(() => {
      active = false;
      notify?.();
      late({}, new Date(combined.max));
    });
    expect(
      screen.queryByTestId('conversation-a2ui-local-datetime-picker'),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /가상 독서 날짜와 시간/ }),
    ).toBeNull();
    await act(() => {
      active = true;
      notify?.();
    });
    expect(opener()).toHaveTextContent('날짜와 시간 선택');
  } finally {
    await ui.unmount();
  }
});

test('combined date-time is optional and never upgrades the stored v64 contract', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '64',
  });
  const fallback = {
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  };
  expect(old?.taskVersion).toBe('64');
  expect(old?.validateResult(proposal(combined), input)).toEqual(fallback);
  expect(
    ragConversationTask.validateResult(
      proposal({ ...combined, min: undefined, max: undefined }),
      input,
    ),
  ).toMatchObject({
    status: 'valid',
    value: { a2uiPresentation: expect.anything() },
  });
  for (const request of [
    proposal({ ...combined, min: '2035-02-29T12:00:00Z' }),
    proposal({ ...combined, min: '2035-06-01T12:00:00' }),
    proposal({ ...combined, max: '2035-06-01T09:59:59+09:00' }),
    proposal({ ...combined, max: { '@path': '/form/current' } }),
    proposal({ ...combined, action: { event: { name: 'schedule' } } }),
    proposal({ ...combined, value: '2035-06-04T10:00:00Z' }),
    proposal(combined, {
      path: '/form/reading',
      value: { day: '2035-06-04T10:00:00Z' },
    }),
  ])
    expect(ragConversationTask.validateResult(request, input)).toEqual(
      fallback,
    );
});
