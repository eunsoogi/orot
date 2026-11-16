import { StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  appointment,
  candidate,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import { theme } from '../../../nextVisitQuestions/testSupport/fixtures';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { ConversationVisitQuestionCard } from '../ConversationVisitQuestionCard';
import type { VisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { t } from '../../../i18n';

async function show(saved: boolean, warning = false, restored = false) {
  const store = createConversationSessions();
  const sessionId = store.getSnapshot().activeId;
  const review = createInlineVisitReview(
    'owner',
    saved
      ? [
          {
            ...candidate,
            identity: { id: 'saved', expectedRevision: 'revision' },
          },
        ]
      : [],
    [candidate],
    [],
    () => 'candidate',
  );
  store.setDraft(sessionId, '합성 질문');
  await store.send(sessionId, async () => ({
    status: 'answer',
    answer: '합성 안내',
    citations: [],
    visitQuestions: {
      appointment,
      review,
      validateSource: async () => true,
      restorationNotice: '합성 과거 메타데이터 안내',
      restorationWarning: warning,
      restoredFromSnapshot: restored,
    },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const save = jest.fn(async () => {
    throw new Error('synthetic write failure');
  });
  await render(
    <ConversationVisitQuestionCard
      message={message}
      sessionId={sessionId}
      store={store}
      operations={{ save } as unknown as VisitQuestionRouteOperations}
      services={{
        resolveSource: () => undefined,
        registerVisitQuestionSource: ref => ref,
      }}
      onOpenSource={() => undefined}
      onRegenerate={() => undefined}
      theme={theme}
    />,
  );
  return { store, save };
}

test('missing historical metadata is informational and explicitly scoped to saved questions', async () => {
  const { store } = await show(true);
  const notice = screen.getByTestId('inline-visit-restoration-notice');
  expect(notice.props.children).toContain('이전에 저장한 질문 안내');
  expect(notice.props.accessibilityRole).not.toBe('alert');
  expect(StyleSheet.flatten(notice.props.style).color).toBe(
    theme.colors.textMuted,
  );
  store.dispose();
});

test('fresh candidates do not inherit unrelated saved-list notices', async () => {
  const { store } = await show(false);
  expect(screen.queryByText(/합성 과거 메타데이터 안내/)).toBeNull();
  store.dispose();
});

test('changed or unavailable historical sources remain an alert', async () => {
  const { store } = await show(true, true);
  const notice = screen.getByTestId('inline-visit-restoration-notice');
  expect(notice.props.accessibilityRole).toBe('alert');
  expect(StyleSheet.flatten(notice.props.style).color).toBe(
    theme.colors.danger,
  );
  store.dispose();
});

test('restored candidate snapshots retain their own notice without a saved list', async () => {
  const { store } = await show(false, false, true);
  expect(
    screen.getByText(t('visitQuestions.conversation.restorationNotice')),
  ).toBeTruthy();
  expect(screen.queryByText(/합성 과거 메타데이터 안내/)).toBeNull();
  store.dispose();
});

test('a real save failure remains a separate error while historical information stays visible', async () => {
  const { store, save } = await show(true);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const failure = await screen.findByText(
    t('visitQuestions.conversation.save.failed'),
  );
  expect(failure.props.accessibilityRole).toBe('alert');
  expect(StyleSheet.flatten(failure.props.style).color).toBe(
    theme.colors.danger,
  );
  expect(screen.getByTestId('inline-visit-restoration-notice')).toBeTruthy();
  store.dispose();
});
