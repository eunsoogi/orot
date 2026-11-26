import type { TaskResponderInput } from '@orot/agent-runtime';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationA2UICatalog } from '../conversationA2UI';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

const first = '한글 **강조**와 *기울임* 그리고 `abc`.';
const second = '다른 **관점**입니다.';
const answer = ['개요', first, '예시', second].join('\n');
const input = {
  request: '예시를 간단히 보여 줘.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as TaskResponderInput;

function response(rawAnswer = answer, pane = first, alternate = second) {
  return {
    answer: rawAnswer,
    answerKind: 'conversation',
    a2uiFrames: [
      JSON.stringify({
        version: '1.0',
        createSurface: {
          surfaceId: 'orot:response:draft',
          catalogId: conversationA2UICatalog,
          components: [
            {
              id: 'root',
              component: 'Tabs',
              tabs: [
                { title: '개요', child: 'card' },
                { title: '예시', child: 'other' },
              ],
            },
            { id: 'card', component: 'Card', child: 'intro' },
            { id: 'intro', component: 'Text', text: pane },
            { id: 'other', component: 'Text', text: alternate },
          ],
        },
      }),
    ],
  };
}

function surface(responder = ragConversationTask, raw = response()) {
  const result = responder.validateResult(raw, input);
  if (result.status !== 'valid') throw new Error('Expected valid prose.');
  return result.value;
}

it('formats accepted native prose in a Card and inactive Tab without changing the copy answer', async () => {
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const { answer: original, a2uiPresentation } = surface();
    expect(original).toBe(answer);
    if (!a2uiPresentation) throw new Error('Expected fresh ordinary layout.');
    const ui = await render(
      <ConversationA2UISurface root={a2uiPresentation} />,
    );
    try {
      expect(screen.getByText('강조')).toHaveStyle({ fontWeight: '700' });
      expect(screen.getByText('기울임')).toHaveStyle({ fontStyle: 'italic' });
      expect(screen.getByText('abc')).toHaveStyle({ fontFamily: 'Menlo' });
      await fireEvent.press(screen.getByText('예시'));
      expect(screen.getByText('관점')).toHaveStyle({ fontWeight: '700' });
      expect(screen.queryByText('강조')).toBeNull();
    } finally {
      await ui.unmount();
    }
  } finally {
    AppState.currentState = previous;
  }
});

it('keeps historical/archived prose literal and refuses mismatched layout or native link affordances', async () => {
  const v39 = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '39',
  });
  if (!v39) throw new Error('Expected retained V39 contract.');
  const legacy = surface(v39);
  const fresh = surface();
  const plain = response(
    '개요\n일반 문장\n예시\n다른 관점입니다.',
    '일반 문장',
    '다른 관점입니다.',
  );
  expect(legacy.a2uiPresentation).toBeUndefined();
  if (!fresh.a2uiPresentation) throw new Error('Expected fresh layout.');
  const shape = storeConversationA2UILayout(fresh.a2uiPresentation, answer);
  expect(shape).toBeUndefined();
  const priorRoot = surface(v39, plain).a2uiPresentation;
  if (!priorRoot) throw new Error('Expected historical plain layout.');
  const archived = restoreConversationA2UILayout(
    storeConversationA2UILayout(priorRoot, plain.answer),
    plain.answer,
  );
  if (!archived) throw new Error('Expected valid archived layout.');
  await render(<ConversationA2UISurface root={archived} testID="archived" />);
  expect(
    within(screen.getByTestId('archived')).getByText('일반 문장'),
  ).toBeTruthy();
  expect(
    surface(ragConversationTask, response(answer, '다른 문장'))
      .a2uiPresentation,
  ).toBeUndefined();

  const literal =
    '**강조** [열기](https://example.com) ![그림](https://example.com/p.png) <em>HTML</em>';
  const raw = response(answer.replace(first, literal), literal);
  expect(surface(ragConversationTask, raw).a2uiPresentation).toBeUndefined();
  const suppressed = ragConversationTask.validateResult(response(), {
    ...input,
    context: { suppressA2UIPresentation: true },
  });
  expect(
    suppressed.status === 'valid' && suppressed.value.a2uiPresentation,
  ).toBeUndefined();
});
