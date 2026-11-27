import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { render } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { restoreArchivedConversationRichText } from '../archivedConversationRichTextLayout';
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
  expect(
    restoreArchivedConversationRichText(
      { version: 9, tree: ['Column', ['Icon', 'folder'], 1, 0] },
      ['**' + title + '**', body].join('\n'),
    ),
  ).toBeUndefined();
  expect(
    restoreArchivedConversationRichText(
      { version: 9, tree: ['Column', ['Icon', 'info'], 1, 0] },
      ['**' + title + '**', body].join('\n'),
    ),
  ).toBeDefined();
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

function groupedProposal(
  parent: JsonValue[] = ['folder', 'title', 'more', 'body'],
) {
  const result = proposal('folder', parent);
  const surface = result.a2uiFrames[0] as {
    createSurface: { components: JsonValue[] };
  };
  surface.createSurface.components.push({
    id: 'more',
    component: 'Icon',
    name: 'folder',
  });
  return result;
}

test('the current ordinary response renders two independently attached group decorations in reading order', async () => {
  const result = ragConversationTask.validateResult(groupedProposal(), input);
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error(
      'The model-authored grouped layout fell back to plain text',
    );
  const root = result.value.a2uiPresentation;
  const ui = await render(<ConversationA2UISurface root={root} />);
  try {
    const tree = JSON.stringify(ui.toJSON());
    expect(tree.match(/"symbolName":"folder"/g)).toHaveLength(2);
    expect(tree.indexOf(title)).toBeLessThan(tree.indexOf(body));
    expect(ui.queryByRole('image')).toBeNull();
    expect(ui.queryByRole('button')).toBeNull();
    expect(result.value.answer).toBe(answer);
    expect(storeConversationA2UILayout(root, answer)).toEqual({
      version: 2,
      tree: ['Card', ['Column', 0, 0]],
    });
  } finally {
    await ui.unmount();
  }
});

test('v66 retains one-icon grammar; v67 rejects any unowned group adornment', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '66',
  });
  expect(old?.validateResult(groupedProposal(), input)).toEqual(plain);
  expect(old?.validateResult(proposal(), input).status).toBe('valid');
  expect(
    ragConversationTask.validateResult(
      groupedProposal(['folder', 'title', 'body', 'more']),
      input,
    ),
  ).toEqual(plain);
  expect(
    ragConversationTask.validateResult(
      groupedProposal(['folder', 'title', 'body']),
      input,
    ),
  ).toEqual(plain);
});

test.each([3, 4])(
  'grouped decorations obey the exact count limit: %i',
  count => {
    const children = Array.from({ length: count }, (_, i) => ({
      folder: { id: 'folder-' + i, component: 'Icon', name: 'folder' },
      line: {
        id: 'text-' + i,
        component: 'Text',
        text: 'Synthetic group ' + i,
      },
    }));
    const value = proposal();
    value.answer = children.map(({ line }) => line.text).join('\n');
    const surface = value.a2uiFrames[0] as {
      createSurface: { components: JsonValue[] };
    };
    surface.createSurface.components = [
      {
        id: 'root',
        component: 'Column',
        children: children.flatMap(({ folder, line }) => [folder.id, line.id]),
      },
      ...children.flatMap(({ folder, line }): JsonValue[] => [folder, line]),
    ];
    const result = ragConversationTask.validateResult(value, input);
    if (result.status !== 'valid') throw new Error('Expected original answer');
    expect(Boolean(result.value.a2uiPresentation)).toBe(count === 3);
    expect(result.value.answer).toBe(value.answer);
  },
);
