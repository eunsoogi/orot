import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = 'Choose a place to explore.';
const label = 'Places';
const input = {
  request: 'Help me choose among these fictional places.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

function proposal(
  changes: Record<string, unknown> = {},
  seed?: Record<string, unknown>,
) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Card', child: 'group' },
          { id: 'group', component: 'Column', children: ['prose', 'picker'] },
          { id: 'prose', component: 'Text', text: answer },
          {
            id: 'picker',
            component: 'ChoicePicker',
            displayStyle: 'chips',
            variant: 'mutuallyExclusive',
            filterable: true,
            label,
            value: { '@path': '/local/places' },
            options: [
              { label: 'Coastal walk', value: 'walk' },
              {
                label:
                  'A quiet gallery and a windy beach with a long visible label',
                value: 'gallery',
              },
              { label: 'Café stop', value: 'cafe' },
            ],
            ...changes,
          },
        ],
      }),
      ...(seed ? [frame('updateDataModel', seed)] : []),
    ],
  };
}

test.each([
  ['mutuallyExclusive', 'radio', false],
  ['multipleSelection', 'checkbox', true],
] as const)(
  'current ordinary Card mounts wrapping chips for %s',
  async (variant, role, multiple) => {
    const result = ragConversationTask.validateResult(
      proposal({ variant }),
      input,
    );
    if (result.status !== 'valid' || !result.value.a2uiPresentation)
      throw new Error('Expected admitted Basic ChoicePicker chips');
    const root = result.value.a2uiPresentation;
    let current = true;
    const listeners = new Set<() => void>();
    const ui = await render(
      <ConversationA2UILocalDraftOwner.Provider
        value={{
          surface: node =>
            current && node === root ? 'synthetic:choices' : undefined,
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
    const group = () => screen.getByLabelText(label);
    const choices = () => within(group()).getAllByRole(role);
    const query = () => screen.getByLabelText('Places 검색');
    const checked = (place: string) =>
      within(group()).getByRole(role, { name: place }).props.accessibilityState
        .checked;
    const owns = (next: boolean) =>
      act(() => {
        current = next;
        listeners.forEach(listener => listener());
      });
    try {
      expect(StyleSheet.flatten(group().props.style)).toMatchObject({
        flexDirection: 'row',
        flexWrap: 'wrap',
      });
      expect(StyleSheet.flatten(choices()[1]?.props.style)).toMatchObject({
        maxWidth: '100%',
        flexShrink: 1,
        minHeight: 44,
      });
      expect(choices()).toHaveLength(3);
      expect(checked('Coastal walk')).toBe(false);
      await fireEvent.press(choices()[0]!);
      expect(checked('Coastal walk')).toBe(true);
      await fireEvent.changeText(query(), 'CAF');
      expect(choices()).toHaveLength(1);
      await fireEvent.press(choices()[0]!);
      await fireEvent.changeText(query(), '');
      expect(checked('Coastal walk')).toBe(multiple);
      expect(checked('Café stop')).toBe(true);
      expect(screen.getByText(answer)).toBeVisible();
      expect(result.value.answer).toBe(answer);
      expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
      await owns(false);
      expect(screen.queryByLabelText(label)).toBeNull();
      await owns(true);
      expect(checked('Café stop')).toBe(false);
      expect(query()).toHaveProp('value', '');
    } finally {
      await ui.unmount();
    }
  },
);

const plain = {
  status: 'valid',
  value: { answerKind: 'conversation', answer },
};

test('the v65 contract does not advertise or admit chip layout and default styles still work', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '65',
  });
  expect(old?.taskVersion).toBe('65');
  expect(old?.validateResult(proposal(), input)).toEqual(plain);
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'displayStyle',
  );
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('displayStyle');
  for (const displayStyle of [undefined, 'checkbox'])
    expect(
      ragConversationTask.validateResult(proposal({ displayStyle }), input),
    ).toMatchObject({
      status: 'valid',
      value: { a2uiPresentation: expect.anything() },
    });
});

test.each([
  proposal({ displayStyle: { '@path': '/local/style' } }),
  proposal({ displayStyle: 'custom' }),
  proposal({ action: { event: { name: 'send' } } }),
  proposal({ value: 'model-seeded' }),
  proposal({}, { path: '/local/places', value: ['walk'] }),
])(
  'unsupported presentation, action, or preselection preserves only exact original prose',
  request => {
    expect(ragConversationTask.validateResult(request, input)).toEqual(plain);
  },
);
