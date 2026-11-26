import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { conversationA2UICatalog } from '../conversationA2UI';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const answer = '가상의 독서 계획이에요.\n페이지 두 장을 읽어요.';
const [heading, note] = answer.split('\n');
const input = {
  request: '두 항목의 배치를 바꿔 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

const opening = frame('createSurface', {
  catalogId: conversationA2UICatalog,
  components: [
    { id: 'root', component: 'Card', child: 'group' },
    { id: 'group', component: 'Column', children: ['heading', 'note'] },
    { id: 'heading', component: 'Text', text: heading },
    { id: 'note', component: 'Text', text: note },
  ],
});
const updated = (children = ['heading', 'note'], extra: object[] = []) =>
  frame('updateComponents', {
    components: [{ id: 'root', component: 'Row', children }, ...extra],
  });
const replaced = updated();
const proposal = (a2uiFrames: string[]) => ({
  answerKind: 'conversation',
  answer,
  a2uiFrames,
});
const envelope = (a2uiFrames: string[]) =>
  JSON.stringify({ type: 'result', value: proposal(a2uiFrames) });

test('an owning update atomically retires the replaced wrapper and preserves exact rendered answer', async () => {
  const candidate = proposal([opening, replaced]);
  const accepted = ragConversationTask.validateResult(candidate, input);
  if (accepted.status !== 'valid') throw new Error('Expected ordinary reply');
  expect(accepted.value.answer).toBe(answer);
  expect(accepted.value.a2uiPresentation?.component).toBe('Row');
  await render(
    <ConversationMessageText
      content={answer}
      user={false}
      verifiedA2UI={accepted.value.a2uiPresentation}
    />,
  );
  const row = screen.getByTestId('conversation-a2ui-row');
  await fireEvent(row, 'layout', { nativeEvent: { layout: { width: 600 } } });
  expect(screen.getByText(heading!)).toBeVisible();
  expect(screen.getByText(note!)).toBeVisible();
  const legacy = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '48',
  });
  expect(legacy?.validateResult(candidate, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

test('the same provisional layout can change geometry, but delete withdraws it without resurrection', () => {
  const project = (frames: string[]) =>
    ragConversationTask.projectStreamedLayout?.(envelope(frames), input);
  const deleted = frame('deleteSurface', {});
  expect(project([opening])).toEqual({ kind: 'stack', slots: 2 });
  expect(project([opening, replaced])).toEqual({ kind: 'row', slots: 2 });
  expect(project([opening, replaced, deleted])).toBeUndefined();
  expect(project([opening, replaced, deleted, opening])).toBeUndefined();
});

test('retains existing staging of a new unparented wrapper until it is installed', () => {
  const newRoot = { id: 'root', component: 'Row', children: ['outer'] };
  const stage = frame('updateComponents', {
    components: [{ id: 'outer', component: 'Card', child: 'group' }],
  });
  const install = frame('updateComponents', { components: [newRoot] });
  // Stage a standalone placeholder first, without introducing a second parent.
  const independentStage = frame('updateComponents', {
    components: [{ id: 'outer', component: 'Card', child: 'pending' }],
  });
  const attach = frame('updateComponents', {
    components: [newRoot, { id: 'outer', component: 'Card', child: 'group' }],
  });
  expect(
    ragConversationTask.projectStreamedLayout?.(
      envelope([opening, independentStage, attach]),
      input,
    ),
  ).toEqual({ kind: 'stack', slots: 1 });
  expect(
    ragConversationTask.validateResult(
      proposal([opening, independentStage, attach]),
      input,
    ),
  ).toMatchObject({
    status: 'valid',
    value: { a2uiPresentation: { component: 'Row' } },
  });
  expect(
    ragConversationTask.validateResult(
      proposal([opening, stage, install]),
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

test.each([
  [opening, updated(['note', 'heading'])],
  [opening, updated(['heading'])],
  [opening, updated(['heading', 'unknown'])],
  [
    opening,
    updated(undefined, [
      { id: 'group', component: 'Column', children: ['note'] },
    ]),
  ],
  [
    opening,
    updated(undefined, [
      { id: 'stray', component: 'Column', children: ['note'] },
    ]),
  ],
  [opening, replaced, updated(['group', 'heading'])],
  [
    opening,
    replaced,
    updated(undefined, [
      { id: 'group', component: 'Column', children: ['note'] },
    ]),
  ],
  [
    opening,
    frame('updateComponents', {
      surfaceId: 'orot:other:response',
      components: [
        { id: 'root', component: 'Row', children: ['heading', 'note'] },
      ],
    }),
  ],
])(
  'rejects unowned, incomplete, or reordered replacement graph %# as optional plain prose',
  (...frames) => {
    expect(ragConversationTask.validateResult(proposal(frames), input)).toEqual(
      {
        status: 'valid',
        value: { answerKind: 'conversation', answer },
      },
    );
  },
);
