import { conversationA2UIComposedControl } from '../conversationA2UIComposedControlState';
import { createConversationA2UITabSelections } from '../conversationA2UITabSelectionLifetime';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { localA2UIDraftResetAction } from '../conversationA2UILocalDraft';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = '준비\n할 일을 읽어 봐요.\n선택\n원하는 걸 골라요.\n선택 초기화';
const input = {
  request: '가상 준비 목록을 두 단계로 보여 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];
const proposal = {
  answerKind: 'conversation',
  answer,
  a2uiFrames: [
    frame('createSurface', {
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Tabs',
          tabs: [
            { title: '준비', child: 'prep' },
            { title: '선택', child: 'choose' },
          ],
        },
        { id: 'prep', component: 'Column', children: ['intro', 'check'] },
        { id: 'intro', component: 'Text', text: '할 일을 읽어 봐요.' },
        {
          id: 'check',
          component: 'CheckBox',
          label: '준비 완료',
          value: { '@path': '/local/ready' },
        },
        {
          id: 'choose',
          component: 'Column',
          children: ['explain', 'choice', 'reset'],
        },
        { id: 'explain', component: 'Text', text: '원하는 걸 골라요.' },
        {
          id: 'choice',
          component: 'ChoicePicker',
          label: '간식',
          variant: 'mutuallyExclusive',
          value: { '@path': '/local/snack' },
          options: [
            { label: '사과', value: 'apple' },
            { label: '배', value: 'pear' },
          ],
        },
        {
          id: 'reset',
          component: 'Button',
          child: 'resetLabel',
          action: { event: { name: localA2UIDraftResetAction, context: {} } },
        },
        { id: 'resetLabel', component: 'Text', text: '선택 초기화' },
      ],
    }),
  ],
};

test.each([true, false])(
  'local selections are only retained across tabs for the fresh owning reply: %s',
  async shouldRetain => {
    const task = shouldRetain
      ? ragConversationTask
      : restoreConversationTask({
          taskType: ragConversationTask.taskType,
          taskVersion: '55',
        });
    const accepted = task?.validateResult(proposal, input);
    if (accepted?.status !== 'valid' || !accepted.value.a2uiPresentation)
      throw new Error('Expected accepted local tabs');
    const root = accepted.value.a2uiPresentation;
    let active = true;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    const ui = await render(
      <ConversationA2UILocalDraftOwner.Provider
        value={{
          surface: node =>
            active && node === root ? 'synthetic:tabs' : undefined,
          subscribe(listener) {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        }}
      >
        <ConversationA2UISurface root={root} />
      </ConversationA2UILocalDraftOwner.Provider>,
    );
    const tab = (name: string) =>
      fireEvent.press(screen.getByRole('tab', { name }));
    const toggle = () => screen.getByLabelText('준비 완료');
    const fruit = () => screen.getByRole('radio', { name: '사과' });
    // With no edits yet, rapid owner loss/return may not publish an
    // intermediate inactive React snapshot. The next edit must still persist.
    await act(() => {
      active = false;
      notify();
      active = true;
      notify();
    });
    await fireEvent(toggle(), 'valueChange', true);
    await tab('선택');
    expect(screen.queryByLabelText('준비 완료')).toBeNull();
    await fireEvent.press(fruit());
    await tab('준비');
    expect(screen.queryByRole('radio', { name: '사과' })).toBeNull();
    expect(toggle()).toHaveProp('value', shouldRetain);
    await tab('선택');
    expect(fruit()).toHaveProp('accessibilityState', { checked: shouldRetain });
    await fireEvent.press(screen.getByRole('button', { name: '선택 초기화' }));
    expect(fruit()).toHaveProp('accessibilityState', { checked: false });
    await tab('준비');
    expect(toggle()).toHaveProp('value', false);
    await fireEvent(toggle(), 'valueChange', true);
    await act(() => {
      active = false;
      notify();
    });
    expect(screen.queryByLabelText('준비 완료')).toBeNull();
    await act(() => {
      active = true;
      notify();
    });
    expect(toggle()).toHaveProp('value', false);
    if (shouldRetain) {
      await fireEvent(toggle(), 'valueChange', true);
      await act(() => {
        active = false;
        notify();
        active = true;
        notify();
      });
      expect(toggle()).toHaveProp('value', false);
    }
    expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
    await ui.unmount();
  },
);

test('a fresh empty stale tab map retires without asking for a replacement revision', () => {
  const accepted = ragConversationTask.validateResult(proposal, input);
  if (
    accepted.status !== 'valid' ||
    accepted.value.a2uiPresentation?.component !== 'Tabs'
  )
    throw new Error('Expected trusted Tabs root');
  const root = accepted.value.a2uiPresentation;
  const preparation = root.tabs[0]?.child;
  if (preparation?.component !== 'Column')
    throw new Error('Expected preparation panel');
  const node = preparation.children.find(child => child.id === 'check');
  const control = node && conversationA2UIComposedControl(node);
  if (!control) throw new Error('Expected trusted checkbox');
  const empty = createConversationA2UITabSelections(root, 0);
  const populated = createConversationA2UITabSelections(root, 1);
  if (!empty || !populated) throw new Error('Expected owned selection maps');
  expect(empty.requestReplacement()).toBe(false);
  expect(empty.retire()).toBe(false);
  expect(empty.requestReplacement()).toBe(true);
  expect(empty.requestReplacement()).toBe(false);
  empty.write(control, true);
  expect(empty.read(control)).toBeUndefined();
  populated.write(control, true);
  expect(populated.retire()).toBe(true);
  expect(populated.retire()).toBe(false);
  expect(populated.read(control)).toBeUndefined();
});

test('an immediately inactive owner stays neutral through sustained renders and reactivation', async () => {
  const accepted = ragConversationTask.validateResult(proposal, input);
  if (accepted.status !== 'valid' || !accepted.value.a2uiPresentation)
    throw new Error('Expected accepted local tabs');
  const root = accepted.value.a2uiPresentation;
  let active = false;
  const listeners = new Set<() => void>();
  const owner = {
    surface: () => (active ? 'synthetic:sustained' : undefined),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const scene = (tag: string) => (
    <ConversationA2UILocalDraftOwner.Provider value={owner}>
      <ConversationA2UISurface root={root} testID={tag} />
    </ConversationA2UILocalDraftOwner.Provider>
  );
  const notify = () => listeners.forEach(listener => listener());
  const ui = await render(scene('initial'));
  expect(screen.queryByLabelText('준비 완료')).toBeNull();
  expect(screen.getByText('할 일을 읽어 봐요.')).toBeVisible();
  await ui.rerender(scene('still-inactive-1'));
  await ui.rerender(scene('still-inactive-2'));
  await act(() => {
    active = true;
    notify();
  });
  const toggle = () => screen.getByLabelText('준비 완료');
  expect(toggle()).toHaveProp('value', false);
  await fireEvent(toggle(), 'valueChange', true);
  await act(() => {
    active = false;
    notify();
  });
  await ui.rerender(scene('still-inactive-3'));
  await ui.rerender(scene('still-inactive-4'));
  expect(screen.queryByLabelText('준비 완료')).toBeNull();
  await act(() => {
    active = true;
    notify();
  });
  expect(toggle()).toHaveProp('value', false);
  await ui.unmount();
  expect(listeners.size).toBe(0);
});
