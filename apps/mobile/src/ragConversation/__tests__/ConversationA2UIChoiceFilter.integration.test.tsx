import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = 'Choose the plans you want to try.';
const label = 'Plans';
const input = {
  request: 'Show a searchable list of synthetic plans.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

function proposal(key: Record<string, unknown> = { filterable: true }) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Column', children: ['intro', 'picker'] },
          { id: 'intro', component: 'Text', text: answer },
          {
            id: 'picker',
            component: 'ChoicePicker',
            label,
            variant: 'multipleSelection',
            value: { '@path': '/local/plans' },
            options: [
              { label: 'Coastal walk', value: 'trip' },
              { label: 'Local gallery', value: 'art' },
              { label: 'Cafe stop', value: 'drink' },
            ],
            ...key,
          },
        ],
      }),
    ],
  };
}

const plain = {
  status: 'valid',
  value: { answerKind: 'conversation', answer },
};

test('filtering visible options never replaces the exact mounted choice selection', async () => {
  const accepted = ragConversationTask.validateResult(proposal(), input);
  if (accepted.status !== 'valid' || !accepted.value.a2uiPresentation)
    throw new Error('Expected filterable choice in an ordinary reply');
  const root = accepted.value.a2uiPresentation;
  let owns = true;
  const listeners = new Set<() => void>();
  const ui = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: node =>
          owns && node === root ? 'synthetic:plans' : undefined,
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
  const query = () => screen.getByLabelText('Plans 검색');
  const option = (name: string) => screen.getByRole('checkbox', { name });
  const absent = (name: string) => screen.queryByRole('checkbox', { name });
  const owner = (next: boolean) =>
    act(() => {
      owns = next;
      listeners.forEach(listener => listener());
    });
  try {
    await fireEvent.press(option('Coastal walk'));
    await fireEvent.changeText(query(), 'GALL');
    expect(absent('Coastal walk')).toBeNull();
    expect(absent('Cafe stop')).toBeNull();
    expect(option('Local gallery')).toBeVisible();
    await fireEvent.press(option('Local gallery'));
    await fireEvent.changeText(query(), 'trip');
    expect(absent('Coastal walk')).toBeNull();
    expect(screen.getByText('일치하는 선택지가 없어요.')).toBeVisible();
    await fireEvent.changeText(query(), '');
    expect(option('Coastal walk')).toHaveProp('accessibilityState', {
      checked: true,
    });
    expect(option('Local gallery')).toHaveProp('accessibilityState', {
      checked: true,
    });
    await fireEvent.changeText(query(), 'Cafe');
    expect(option('Cafe stop')).toBeVisible();
    expect(screen.getByText(answer)).toBeVisible();
    expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
    // A resume batch may never render an inactive snapshot for this stamp.
    await act(() => {
      owns = false;
      listeners.forEach(listener => listener());
      owns = true;
      listeners.forEach(listener => listener());
    });
    expect(query()).toHaveProp('value', '');
    expect(option('Coastal walk')).toBeVisible();
    await fireEvent.changeText(query(), 'Cafe');
    await owner(false);
    expect(screen.queryByLabelText('Plans 검색')).toBeNull();
    await owner(true);
    expect(query()).toHaveProp('value', '');
    expect(option('Coastal walk')).toHaveProp('accessibilityState', {
      checked: false,
    });
  } finally {
    await ui.unmount();
  }
});

test('v57 continues to reject filterable and never advertises it', () => {
  const historical = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '57',
  });
  expect(historical?.validateResult(proposal(), input)).toEqual(plain);
  expect(
    JSON.stringify(historical?.createResultSchema?.(input, true)),
  ).not.toContain('filterable');
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('filterable');
  expect(
    ragConversationTask.validateResult(proposal({ filterable: false }), input),
  ).toMatchObject({
    status: 'valid',
    value: { a2uiPresentation: expect.anything() },
  });
});

test.each([
  { filterable: 'true' },
  { filterable: { '@path': '/real/query' } },
  { filterable: true, action: { event: { name: 'forward' } } },
  { filterable: true, query: 'hidden model query' },
])('rejects unowned search parameters and action', invalid => {
  expect(ragConversationTask.validateResult(proposal(invalid), input)).toEqual(
    plain,
  );
});
