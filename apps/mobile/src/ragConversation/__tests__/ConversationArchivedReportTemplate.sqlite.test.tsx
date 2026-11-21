import { act, render, within } from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import {
  date,
  setup,
} from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationMessage } from '../ConversationMessage';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { possibilityReportTemplate } from '../conversationReportTemplate';
import { dailyConversationReportHeadings } from '../dailyConversationReportTemplate';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';

function ArchivedTranscript({
  store,
  onOpenSource,
}: {
  store: ConversationSessions;
  onOpenSource: jest.Mock;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = state.sessions.find(row => row.id === state.activeId)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      sessionId={session.id}
      pendingMessage={null}
      error={session.error}
      onOpenSource={onOpenSource}
      onLinkError={jest.fn()}
    />
  );
}

test('the same canonical report template renders before and after restoring a durable answer', async () => {
  const f = await setup();
  const onOpenSource = jest.fn();
  const strict = jest.fn(async () => {
    throw new Error('Archived report tried to verify its original source.');
  });
  const store = createConversationSessions({
    retention: createConversationSessionRetention({
      openStorage: async () => f.storage,
      createId: () => 'new',
      now: () => date,
    }),
    restoreSession: strict,
    restoreSessionPage: strict,
    readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
      async () => ({
        ...f.storage,
        readSessionPresentationMany: (_sessionId, version, ids) =>
          f.display(ids, version),
      }),
    ),
  });
  try {
    const template = possibilityReportTemplate();
    const body = template.sections.map(
      (_section, index) => `Synthetic section ${index + 1}`,
    );
    const raw = [
      `# ${template.title}`,
      ...template.sections.map(
        (section, index) => `## ${section}\n${body[index]}`,
      ),
    ].join('\n');
    const fake = `# ${template.title}\n\n## Unsupported section\nPlain Markdown remains intact.`;
    const dailyTitle = t('dailyReport.title');
    const dailySection = dailyConversationReportHeadings()[0]!;
    const daily = `# ${dailyTitle}\n\nSynthetic daily introduction\n\n## ${dailySection}\nDaily body.`;
    const archived = await f.save('disease-template', {
      entryIntent: 'possibilities',
      answer: raw,
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    await f.save('generic-markdown', { answer: fake });
    await f.save('daily-template', { answer: daily });
    const live = await render(
      <ConversationMessage
        message={{
          id: 700,
          role: 'assistant',
          content: raw,
          citations: archived.citations,
        }}
        onOpenSource={onOpenSource}
        onLinkError={jest.fn()}
      />,
    );
    const assertSameTemplate = (scope: ReturnType<typeof within>) => {
      expect(scope.getByRole('header', { name: template.title })).toBeTruthy();
      for (const [index, heading] of template.sections.entries()) {
        expect(scope.getByText(heading)).toBeTruthy();
        expect(scope.getByText(body[index]!)).toBeTruthy();
      }
      expect(scope.queryByText(raw)).toBeNull();
    };
    assertSameTemplate(live);
    expect(
      live.getByTestId('rag-conversation-message-700-citation-0'),
    ).toBeTruthy();
    await live.unmount();
    const cold = await render(
      <ArchivedTranscript store={store} onOpenSource={onOpenSource} />,
    );
    try {
      await act(async () => {
        await store.attachExisting('selected', 0, date);
      });
      // The malformed same-title Markdown must not acquire a second report header.
      assertSameTemplate(cold);
      expect(
        cold.getAllByRole('header', { name: template.title }),
      ).toHaveLength(1);
      expect(cold.getByText(fake)).toBeTruthy();
      expect(cold.getByRole('header', { name: dailyTitle })).toBeTruthy();
      expect(cold.getByText(dailySection)).toBeTruthy();
      expect(cold.queryByText(daily)).toBeNull();
      expect(cold.queryByTestId(/-citation-0$/)).toBeTruthy();
      expect(onOpenSource).not.toHaveBeenCalled();
      expect(strict).not.toHaveBeenCalled();
      expect(f.sql.length).toBeGreaterThan(0);
      const state = store.getSnapshot();
      expect(
        state.sessions.find(row => row.id === state.activeId)?.messages,
      ).toEqual([]);
    } finally {
      await cold.unmount();
    }
  } finally {
    store.dispose();
    f.close();
  }
});
