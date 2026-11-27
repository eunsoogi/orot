import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = 'Plan the next step.';
const label = 'My next steps';
const input = {
  request: 'Make an editable space for planning.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

function proposal(
  variant = 'longText',
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

test('the current reply mounts native multiline input only for its exact owner', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected an admitted multiline planning field');
  const root = result.value.a2uiPresentation;
  let active = true;
  const listeners = new Set<() => void>();
  const ui = await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: node =>
          active && node === root ? 'synthetic:notes' : undefined,
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
    expect(field()).toHaveProp('multiline', true);
    expect(field()).toHaveProp('submitBehavior', 'newline');
    expect(field()).toHaveProp('maxLength', 256);
    expect(field()).toHaveProp('value', '');
    const notes = 'First step\nSecond step';
    await fireEvent.changeText(field(), notes);
    expect(field()).toHaveProp('value', notes);
    await fireEvent.changeText(field(), notes.repeat(20));
    expect(field()).toHaveProp('value', notes.repeat(20).slice(0, 256));
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

test('registered v56 retains short text only and its original prompt', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '56',
  });
  expect(old?.taskVersion).toBe('56');
  expect(old?.validateResult(proposal(), input)).toEqual(prose());
  expect(old?.validateResult(proposal('shortText'), input)).toMatchObject({
    status: 'valid',
    value: { a2uiPresentation: expect.anything() },
  });
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'longText',
  );
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('longText');
});

function prose() {
  return { status: 'valid', value: { answerKind: 'conversation', answer } };
}

test.each([
  proposal('number'),
  proposal('obscured'),
  proposal('longText', { action: { event: { name: 'send' } } }),
  proposal('longText', { value: 'preloaded text' }),
  proposal('longText', {}, { form: { notes: 'preloaded text' } }),
  proposal('longText', {}, undefined, [
    frame('updateDataModel', {
      path: '/form',
      value: { notes: 'preloaded text' },
    }),
  ]),
])('falls back to exact prose for unsupported or seeded fields', value => {
  expect(ragConversationTask.validateResult(value, input)).toEqual(prose());
});
