import { createDailyReportIdentity } from '@orot/domain';
import { fireEvent, render } from '@testing-library/react-native';
import { DailyReportSourceResolverContext } from '../../aiFeatures/integration/DailyReportSourceLinks';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { t } from '../../i18n';
import {
  date,
  setup,
} from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { ConversationMessage } from '../ConversationMessage';
import { dailyConversationReportHeadings } from '../dailyConversationReportTemplate';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';

test('persisted daily metadata uses the canonical report and its exact tap-only source action', async () => {
  const f = await setup();
  try {
    const target = {
      identity: createDailyReportIdentity('2026-10-05', 'UTC'),
      runId: 'synthetic-daily-run',
      revision: 3,
    };
    const title = t('dailyReport.title');
    const section = dailyConversationReportHeadings()[0]!;
    const saved = {
      id: 'daily-archive',
      createdAt: date,
      sessionId: 'selected',
      question: 'Synthetic daily report question',
      answer: `# ${title}\n\nSynthetic intro\n\n## ${section}\nSynthetic body.`,
      status: 'complete',
      dailyReport: target,
      citations: [f.personal.reference],
    };
    // Exact old saved row shape; intentionally no modern report lookup on archive paint.
    await f.db.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [saved.id, saved.sessionId, saved.createdAt, JSON.stringify(saved)],
    );
    const read = conversationSavedHistoryDisplayOption(async () => ({
      ...f.storage,
      readSessionPresentationMany: (_sessionId, version, ids) =>
        f.display(ids, version),
    }));
    const page = await read(saved.sessionId, 0, new AbortController().signal);
    const [row] = page.rows;
    expect(row).toMatchObject({ kind: 'answer', dailyReport: target });
    const message = savedHistoryTranscript(
      [{ row: row!, questionId: -1, answerId: -2 }],
      [],
    )[1]!;
    expect(message.retainedTurnId).toBeUndefined();
    expect(message.citations).toBeUndefined();
    const resolver = jest.fn(async () => ({ status: 'stale' as const }));
    const onLinkError = jest.fn();
    const onOpenSource = jest.fn();
    const ui = await render(
      <DailyReportSourceResolverContext.Provider value={resolver}>
        <ConversationMessage
          message={message}
          onOpenSource={onOpenSource}
          onLinkError={onLinkError}
        />
      </DailyReportSourceResolverContext.Provider>,
    );
    try {
      expect(ui.getByRole('header', { name: title })).toBeTruthy();
      expect(ui.getByText(section)).toBeTruthy();
      expect(ui.getByText(/2026-10-05/)).toBeTruthy();
      expect(resolver).not.toHaveBeenCalled();
      expect(onOpenSource).not.toHaveBeenCalled();
      expect(ui.queryByTestId(/-saved-citation-0$/)).toBeNull();
      await fireEvent.press(
        ui.getByTestId('rag-conversation-message--2-report-sources'),
      );
      expect(resolver).toHaveBeenCalledWith(
        target.identity,
        target.runId,
        target.revision,
        expect.any(AbortSignal),
        'presentation',
      );
      expect(onLinkError).toHaveBeenCalledTimes(1);
      expect(ui.getByRole('header', { name: title })).toBeTruthy();
      expect(ui.getByText(section)).toBeTruthy();
      expect(f.sql.length).toBeGreaterThan(0);
      expect(
        f.sql.every(
          query =>
            !/daily_report|symptom_summary_runs|health_observations/i.test(
              query,
            ),
        ),
      ).toBe(true);
    } finally {
      await ui.unmount();
    }
  } finally {
    f.close();
  }
});
