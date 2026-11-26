import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessageText } from '../ConversationMessageText';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { a2uiSurfaceStyles } from '../conversationA2UISurfaceStyles';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { frame } from '../testSupport/a2uiLocalFormFixtures';

const lines = [
  '시작',
  '첫날은 한 장씩 읽어요.',
  '준비물은 책과 메모지예요.',
  '마무리',
  '기억에 남는 문장을 골라요.',
  '짧게 기록해도 괜찮아요.',
] as const;
const answer = lines.join('\n');
const input = {
  request: '가상의 독서 계획을 두 부분으로 정리해 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

function proposal(
  changes: Record<string, unknown> = {},
  surface = {},
  extra: string[] = [],
) {
  return {
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
              { title: lines[0], child: 'first-group' },
              { title: lines[3], child: 'second-group' },
            ],
          },
          {
            id: 'first-group',
            component: 'Column',
            children: ['first', 'first-caption'],
          },
          { id: 'first', component: 'Text', text: lines[1] },
          {
            id: 'first-caption',
            component: 'Text',
            variant: 'caption',
            text: lines[2],
            ...changes,
          },
          { id: 'second-group', component: 'Card', child: 'second-content' },
          {
            id: 'second-content',
            component: 'Column',
            children: ['second', 'second-caption'],
          },
          { id: 'second', component: 'Text', text: lines[4] },
          {
            id: 'second-caption',
            component: 'Text',
            variant: 'caption',
            text: lines[5],
          },
        ],
        ...surface,
      }),
      ...extra,
    ],
  };
}

test('two independently composed panels keep accepted prose and render scaled local captions', async () => {
  const candidate = proposal();
  const parsed = ragConversationTask.validateResult(candidate, input);
  if (parsed.status !== 'valid') throw new Error('Expected ordinary reply');
  expect(parsed.value.answer).toBe(answer);
  const root = parsed.value.a2uiPresentation;
  expect(root?.component).toBe('Tabs');
  const mounted = await render(
    <ConversationMessageText
      content={answer}
      user={false}
      verifiedA2UI={root}
    />,
  );
  expect(screen.getByText(lines[2])).toBeVisible();
  expect(screen.getByText(lines[2])).toHaveStyle(a2uiSurfaceStyles.caption);
  expect(screen.getByText(lines[2])).toHaveProp('allowFontScaling', true);
  expect(screen.queryByText(lines[5])).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: lines[3] }));
  expect(screen.getByText(lines[5])).toHaveStyle(a2uiSurfaceStyles.caption);
  expect(screen.getByText(lines[4])).toHaveStyle(a2uiSurfaceStyles.body);
  expect(screen.queryByRole('link')).toBeNull();

  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '47',
  });
  expect(old?.validateResult(candidate, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
  const layout = root && storeConversationA2UILayout(root, answer);
  expect(layout).toBeDefined();
  const restored = layout && restoreConversationA2UILayout(layout, answer);
  expect(restored?.component).toBe('Tabs');
  await mounted.rerender(
    <ConversationMessageText
      content={answer}
      user={false}
      verifiedA2UI={restored}
    />,
  );
  expect(screen.getByText(lines[2])).toHaveStyle(a2uiSurfaceStyles.body);
});

test.each([
  proposal({ text: lines[5] }),
  proposal({ text: { '@path': '/caption' } }),
  proposal({ url: 'https://example.invalid/' }),
  proposal({ action: { event: { name: 'send' } } }),
  proposal({}, { dataModel: { caption: lines[2] } }),
  proposal({}, { sendDataModel: true }),
  proposal({}, {}, [frame('updateDataModel', { path: '/x', value: 'y' })]),
])(
  'unowned, mismatched, or updating captions keep exactly one plain answer',
  value => {
    expect(ragConversationTask.validateResult(value, input)).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer },
    });
  },
);
