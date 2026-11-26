import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = '기차로 이동할 수 있어요.';
const input = {
  request: '가상 여행 선택 UI를 만들어줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];
const components = [
  { id: 'root', component: 'Card', child: 'trip' },
  {
    id: 'trip',
    component: 'Column',
    children: ['suitcase', 'prose', 'transport', 'memo', 'ticket'],
  },
  { id: 'prose', component: 'Text', text: answer },
  {
    id: 'suitcase',
    component: 'CheckBox',
    label: '짐 챙김',
    value: { '@path': '/form/trip/packed' },
  },
  {
    id: 'ticket',
    component: 'CheckBox',
    label: '표 준비',
    value: { '@path': '/local/trip/ticket' },
  },
  {
    id: 'memo',
    component: 'TextField',
    label: '내 메모',
    value: { '@path': '/local/trip/note' },
  },
  {
    id: 'transport',
    component: 'ChoicePicker',
    label: '이동 수단',
    variant: 'mutuallyExclusive',
    value: { '@path': '/local/trip/transport' },
    options: [
      { label: '기차', value: 'train' },
      { label: '버스', value: 'bus' },
      { label: '도보', value: 'walk' },
    ],
  },
];
function proposal(items: unknown = components) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: items,
      }),
    ],
  };
}

test('model-authored controls mount in their own positions and hold independent local state', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid') throw Error('Expected a normal answer.');
  const root = result.value.a2uiPresentation;
  expect(root?.component).toBe('Card');
  let active = true;
  let changeOwner: (() => void) | undefined;
  const owner = {
    surface: () => (active ? 'orot:session:answer' : undefined),
    subscribe(listener: () => void) {
      changeOwner = listener;
      return () => {};
    },
  };
  await render(
    <ConversationA2UILocalDraftOwner.Provider value={owner}>
      <ConversationMessageText
        content={answer}
        user={false}
        verifiedA2UI={root}
      />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  expect(screen.getByLabelText('짐 챙김').props.value).toBe(false);
  await fireEvent(screen.getByLabelText('짐 챙김'), 'valueChange', true);
  expect(screen.getByLabelText('짐 챙김').props.value).toBe(true);
  expect(screen.getByLabelText('표 준비').props.value).toBe(false);
  await fireEvent.press(screen.getByRole('radio', { name: '도보' }));
  expect(
    screen.getByRole('radio', { name: '도보' }).props.accessibilityState
      .checked,
  ).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('내 메모'), '임시 내용');
  expect(screen.getByLabelText('내 메모').props.value).toBe('임시 내용');
  const staleChange = screen.getByLabelText('내 메모').props.onChangeText;
  expect(root && storeConversationA2UILayout(root, answer)).toBeUndefined();
  await act(() => {
    active = false;
    changeOwner?.();
    staleChange('stale input');
  });
  expect(screen.queryByLabelText('내 메모')).toBeNull();
  expect(screen.getByText(answer)).toBeTruthy();
  await act(() => {
    active = true;
    changeOwner?.();
  });
  expect(screen.getByLabelText('내 메모').props.value).toBe('');
});

const removeRule = (changes: Record<string, unknown>) =>
  components.map(item =>
    item.id === 'suitcase' ? { ...item, ...changes } : item,
  );

test.each([
  removeRule({ action: { event: { name: 'write' } } }),
  removeRule({ value: { '@path': '/__proto__/future' } }),
  removeRule({ value: { '@path': '/local/trip/transport' } }),
  removeRule({ label: '표\u202E준비' }),
  removeRule({ label: 'https://example.com' }),
])('falls back atomically for unsupported or foreign fields', items => {
  expect(
    ragConversationTask.validateResult(proposal(items), input),
  ).toMatchObject({
    status: 'valid',
    value: { answer },
  });
  const result = ragConversationTask.validateResult(proposal(items), input);
  if (result.status !== 'valid') throw Error('Expected prose fallback.');
  expect(result.value.a2uiPresentation).toBeUndefined();
});

test('v44 stays immutable; its historical grammar does not admit the new shape', () => {
  const prior = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '44',
  });
  const result = prior?.validateResult(proposal(), input);
  if (result?.status !== 'valid') throw Error('Expected prose fallback.');
  expect(result.value.a2uiPresentation).toBeUndefined();
});

test('multiple selections and controls declared in an update compose without a fixed template', async () => {
  const updates = components.map(item =>
    item.id === 'transport' ? { ...item, variant: 'multipleSelection' } : item,
  );
  const result = ragConversationTask.validateResult(
    {
      ...proposal(),
      a2uiFrames: [
        frame('createSurface', { catalogId: conversationA2UICatalog }),
        frame('updateComponents', { components: updates }),
      ],
    },
    input,
  );
  if (result.status !== 'valid') throw Error('Expected a normal answer.');
  expect(result.value.a2uiPresentation).toBeDefined();
  await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: () => 'orot:session:answer',
        subscribe: () => () => {},
      }}
    >
      <ConversationMessageText
        content={answer}
        user={false}
        verifiedA2UI={result.value.a2uiPresentation}
      />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  await fireEvent.press(screen.getByRole('checkbox', { name: '기차' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: '도보' }));
  expect(
    screen.getByRole('checkbox', { name: '기차' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole('checkbox', { name: '도보' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole('checkbox', { name: '버스' }).props.accessibilityState
      .checked,
  ).toBe(false);
});
