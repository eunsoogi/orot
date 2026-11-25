import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { savedHistoryTranscript } from '../../ragConversation/conversationSavedHistoryDisplay';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationMessage } from '../../ragConversation/ConversationMessage';
import { conversationRestoredMessages } from '../../ragConversation/conversationRestoredMessages';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { createGeneratedReportReader } from '../readers';
import { render } from '@testing-library/react-native';
import { GeneratedReportContent } from '../GeneratedReportContent';
import { t } from '../../i18n';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../../diseaseHypotheses/summaryPartialEvidence';

/** Reopening a saved result must not lose its field-specific safety review notices. */
test('saved content retains all four review warnings alongside partial and source notices', async () => {
  const ui = await render(
    <GeneratedReportContent
      detail={{
        paragraphs: ['Synthetic saved report'],
        warning: 'Synthetic source warning',
        analysis: {
          hypotheses: [],
          omittedUnsupportedContent: true,
          incompleteEvidence: true,
          savedSummary: {
            status: 'saved',
            id: 'synthetic-summary',
            createdAt: '2026-01-01T00:00:00Z',
            modelName: 'synthetic',
            contentReviewIssues: [
              'prescription',
              'sleep_count',
              'sleep_duration',
              'step_unit',
            ],
          },
        },
      }}
    />,
  );
  for (const [issue, key] of [
    ['prescription', 'summaryHistory.reviewPrescription'],
    ['sleep_count', 'summaryHistory.reviewSleepCount'],
    ['sleep_duration', 'summaryHistory.reviewSleepDuration'],
    ['step_unit', 'summaryHistory.reviewSteps'],
  ] as const) {
    expect(
      ui.getByTestId(`summary-content-review-${issue}`).props.accessibilityRole,
    ).toBe('alert');
    expect(ui.getByText(t(key))).toBeTruthy();
  }
  expect(ui.getByText('Synthetic saved report')).toBeTruthy();
  expect(ui.getByTestId('generated-report-paragraph-0')).toHaveTextContent(
    'Synthetic saved report',
  );
  expect(ui.getByText('Synthetic source warning')).toBeTruthy();
  expect(ui.getByText(OMITTED_SUMMARY_CONTENT_NOTE)).toBeTruthy();
  expect(ui.getByText(INCOMPLETE_SUMMARY_EVIDENCE_NOTE)).toBeTruthy();
});

// This stored narrative is not any current canonical template; only its existing heading
// punctuation is presentational. Its original text and citation policy must not change.
test('one SQLite-committed legacy report shares a safe heading and keeps its occurrence', async () => {
  const f = await setup();
  const question = 'Synthetic archived request';
  const answer =
    '## Earlier notes\nSynthetic report body.\n\n> ## Quoted heading marker\n~~~text\n## Fenced literal\n~~~\n[Plain link label](https://example.invalid)';
  try {
    const original = await f.save('legacy-narrative', {
      entryIntent: 'possibilities',
      question,
      answer,
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    const reader = createGeneratedReportReader(f.db);
    const row = (await reader.list()).find(
      item => item.key === 'conversation:legacy-narrative',
    );
    expect(row).toBeDefined();
    const detail = await reader.read(row!, new AbortController().signal);
    expect(detail?.paragraphs).toEqual([answer]);
    expect(detail?.conversationSources).toBeUndefined();
    const openCitation = jest.fn();
    const records = await render(
      <GeneratedReportContent detail={detail!} onOpenCitation={openCitation} />,
    );
    expect(
      records.getByRole('header', { name: 'Earlier notes' }),
    ).toBeVisible();
    expect(records.queryByText('## Earlier notes')).toBeNull();
    expect(records.getByText(/> ## Quoted heading marker/)).toBeTruthy();
    expect(records.getByText(/## Fenced literal/)).toBeTruthy();
    expect(records.getByText(/Plain link label/)).toBeTruthy();
    expect(records.queryByRole('link')).toBeNull();
    expect(
      records.queryByTestId('generated-report-source-citation-0'),
    ).toBeNull();
    expect(openCitation).not.toHaveBeenCalled();
    await records.unmount();
    const [saved] = await f.storage.readSessionMany(original.sessionId, 0, [
      original.id,
    ]);
    expect(saved?.answer).toBe(answer);
    const restored = conversationRestoredMessages(
      [
        {
          question,
          answer: saved!.answer,
          entryIntent: 'possibilities',
          citations: [],
        },
      ],
      [[]],
      () => -1,
    )[1]!;
    const readSaved = conversationSavedHistoryDisplayOption(
      async () => f.storage,
    );
    const page = await readSaved(
      original.sessionId,
      0,
      new AbortController().signal,
    );
    const visible = page.rows.find(item => item.id === original.id);
    expect(visible).toMatchObject({
      kind: 'answer',
      answer,
      archivedCitationTarget: {
        sessionId: original.sessionId,
        sessionVersion: 0,
        turnId: original.id,
        createdAt: original.createdAt,
      },
      savedCitations: [{ kind: 'personal_record', ordinal: 0 }],
    });
    const displayOnly = savedHistoryTranscript(
      [{ row: visible!, questionId: -2, answerId: -1 }],
      [],
    )[1]!;
    for (const message of [restored, displayOnly]) {
      expect(message.content).toBe(answer);
      const chat = await render(
        <ConversationMessage
          message={message}
          onOpenSource={jest.fn()}
          onLinkError={jest.fn()}
        />,
      );
      expect(chat.getByRole('header', { name: 'Earlier notes' })).toBeVisible();
      expect(chat.queryByText('## Earlier notes')).toBeNull();
      expect(chat.getByText(/> ## Quoted heading marker/)).toBeTruthy();
      expect(chat.getByText(/## Fenced literal/)).toBeTruthy();
      expect(chat.queryByRole('link')).toBeNull();
      await chat.unmount();
    }
  } finally {
    f.close();
  }
});

test.each([
  { role: 'user' as const, savedPossibilityNarrative: true as const },
  {
    role: 'assistant' as const,
    streaming: true,
    savedPossibilityNarrative: true as const,
  },
  {
    role: 'assistant' as const,
    incomplete: true,
    savedPossibilityNarrative: true as const,
  },
])(
  'user, streaming, and partial text never gain legacy headings: %j',
  async state => {
    const content = '## Literal notes\nSynthetic original';
    const chat = await render(
      <NavigationMotionContext.Provider value>
        <ConversationMessage
          message={{ id: 12, content, ...state }}
          onOpenSource={jest.fn()}
          onLinkError={jest.fn()}
        />
      </NavigationMotionContext.Provider>,
    );
    expect(chat.queryByRole('header')).toBeNull();
    expect(chat.getByText(content)).toBeTruthy();
    await chat.unmount();
  },
);
