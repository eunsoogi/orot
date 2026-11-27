import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = 'Check the number of boxes.';
const label = 'Number of boxes';
const input = {
  request: 'Make a temporary count for the boxes.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

function proposal(
  variant = 'number',
  extra: Record<string, unknown> = {},
  dataModel?: Record<string, unknown>,
  tail: string[] = [],
) {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        ...(dataModel ? { dataModel } : {}),
        components: [
          { id: 'root', component: 'Column', children: ['intro', 'draft'] },
          { id: 'intro', component: 'Text', text: answer },
          {
            id: 'draft',
            component: 'TextField',
            variant,
            label,
            value: { '@path': '/form/notes' },
            ...extra,
          },
        ],
      }),
      ...tail,
    ],
  };
}

test('the current reply mounts a native bounded quantity input only for its exact owner', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected an admitted numeric quantity field');
  const root = result.value.a2uiPresentation;
  let active = true;
  const listeners = new Set<() => void>();
  const ui = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: node =>
          active && node === root ? 'synthetic:boxes' : undefined,
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
  const field = () => screen.getByLabelText(label);
  const setOwner = (current: boolean) =>
    act(() => {
      active = current;
      listeners.forEach(listener => listener());
    });
  try {
    expect(field()).toHaveProp('maxLength', 256);
    expect(field()).toHaveProp('value', '');
    for (const number of ['-0.125', '+2500', '−2,75', '.50', '+', '']) {
      await fireEvent.changeText(field(), number);
      expect(field()).toHaveProp('value', number);
    }
    await fireEvent.changeText(field(), '38.71');
    for (const invalid of ['2e3', '1.2,3', '2 boxes', '44--', '⅘']) {
      await fireEvent.changeText(field(), invalid);
      expect(field()).toHaveProp('value', '38.71');
    }
    await fireEvent.changeText(field(), '1'.repeat(260));
    expect(field()).toHaveProp('value', '1'.repeat(256));
    expect(screen.getByText(answer)).toBeVisible();
    expect(result.value.answer).toBe(answer);
    expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
    await setOwner(false);
    expect(screen.queryByLabelText(label)).toBeNull();
    await setOwner(true);
    expect(field()).toHaveProp('value', '');
  } finally {
    await ui.unmount();
  }
});

test('registered v63 retains previous field semantics and its original prompt', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '63',
  });
  expect(old?.taskVersion).toBe('63');
  expect(old?.validateResult(proposal(), input)).toEqual(prose());
  expect(old?.validateResult(proposal('shortText'), input)).toMatchObject({
    status: 'valid',
    value: { a2uiPresentation: expect.anything() },
  });
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'signed decimal input',
  );
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('signed decimal input');
});

function prose() {
  return { status: 'valid', value: { answerKind: 'conversation', answer } };
}

test.each([
  proposal('obscured'),
  proposal('signed decimal input', {
    action: { event: { name: 'send' } },
  }),
  proposal('signed decimal input', { value: '123' }),
  proposal('signed decimal input', {}, { form: { notes: '123' } }),
  proposal('signed decimal input', {}, undefined, [
    frame('updateDataModel', {
      path: '/form',
      value: { notes: '123' },
    }),
  ]),
])('falls back to exact prose for unsupported or seeded fields', value => {
  expect(ragConversationTask.validateResult(value, input)).toEqual(prose());
});
