import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { render } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import {
  conversationA2UICatalog,
  type ConversationA2UINode,
} from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

const title = '보고서에 포함할 항목';
const body = '준비물과 다음 순서를 확인해요.';
const answer = [title, body].join('\n');
const input = {
  request: '보고서 구성을 보여 주세요.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as TaskResponderInput;

function proposal(
  name: JsonValue = 'folder',
  group: JsonValue[] = ['folder', 'title', 'body'],
  extra: Record<string, JsonValue> = {},
  data = false,
): { answerKind: string; answer: string; a2uiFrames: JsonValue[] } {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'orot:response:draft',
          catalogId: conversationA2UICatalog,
          ...(data ? { dataModel: {} } : {}),
          components: [
            { id: 'root', component: 'Card', child: 'group' },
            { id: 'group', component: 'Column', children: group },
            { id: 'folder', component: 'Icon', name, ...extra },
            { id: 'title', component: 'Text', text: title },
            { id: 'body', component: 'Text', text: body },
          ],
        },
      },
    ],
  };
}

const plain = {
  status: 'valid',
  value: { answerKind: 'conversation', answer },
};

test('ordinary mounted report uses the bundled icon but its archive retains only the same prose layout', async () => {
  const result = ragConversationTask.validateResult(proposal(), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected a pinned folder beside accepted report prose');
  const root = result.value.a2uiPresentation;
  const ui = await render(<ConversationA2UISurface root={root} />);
  try {
    const native = JSON.stringify(ui.toJSON());
    expect(native).toContain('"symbolName":"folder"');
    expect(native).toContain('"accessibilityElementsHidden":true');
    expect(native).toContain(
      '"importantForAccessibility":"no-hide-descendants"',
    );
    expect(ui.getByText(title)).toBeVisible();
    expect(ui.getByText(body)).toBeVisible();
    expect(ui.queryByRole('image')).toBeNull();
    expect(ui.queryByRole('link')).toBeNull();
    expect(ui.queryByRole('button')).toBeNull();
    expect(result.value.answer).toBe(answer);
    const archive = storeConversationA2UILayout(root, answer);
    expect(archive).toEqual({ version: 2, tree: ['Card', ['Column', 0, 0]] });
    const restored = restoreConversationA2UILayout(archive, answer);
    if (!restored) throw new Error('Expected the exact saved prose shape');
    await ui.rerender(<ConversationA2UISurface root={restored} />);
    expect(JSON.stringify(ui.toJSON())).not.toContain('"symbolName"');
    expect(ui.getByText(title)).toBeVisible();
    expect(ui.getByText(body)).toBeVisible();
  } finally {
    await ui.unmount();
  }
});

test('older v59 reply and persisted archive cannot authorize folder', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '59',
  });
  expect(old?.validateResult(proposal(), input)).toEqual(plain);
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'folder',
  );
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('folder');
  expect(
    restoreConversationA2UILayout(
      {
        version: 3,
        tree: ['Card', ['Column', ['Icon', 'folder'], 0, 0]],
      },
      answer,
    ),
  ).toBeUndefined();
  const unapproved: ConversationA2UINode = {
    id: 'root',
    component: 'Column',
    children: [
      { id: 'folder', component: 'Icon', name: 'folder' },
      { id: 'title', component: 'Text', variant: 'body', text: answer },
    ],
  };
  expect(storeConversationA2UILayout(unapproved, answer)).toBeUndefined();
});

test.each([
  proposal('Folder'),
  proposal('warning'),
  proposal({ '@path': '/private/icon' }),
  proposal('folder', ['title', 'body', 'folder']),
  proposal('folder', ['folder', 'title', 'body', 'folder']),
  proposal('folder', ['folder', 'title', 'body'], {
    action: { event: { name: 'open' } },
  }),
  proposal('folder', ['folder', 'title', 'body'], {}, true),
])('rejects unknown, aliased, nonadjacent, or active icons', value => {
  expect(ragConversationTask.validateResult(value, input)).toEqual(plain);
});

test('folder cannot rescue a mismatched accepted answer', () => {
  const reversed = [body, title].join('\n');
  expect(
    ragConversationTask.validateResult(
      { ...proposal(), answer: reversed },
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer: reversed },
  });
});
