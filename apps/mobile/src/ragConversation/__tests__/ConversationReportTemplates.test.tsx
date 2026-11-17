import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import { conversationTaskInput } from '../conversationEntryContext';
import {
  parseConversationReport,
  possibilityReportTemplate,
} from '../conversationReportTemplate';
import { t } from '../../i18n';
import { conversationDailyReportText } from '../../aiFeatures/integration/conversationDailyReportText';
import type { DailyReportLookup } from '../../storage/dailyReportStorageTypes';

const template = possibilityReportTemplate();
const bodies = template.sections.map(
  (_, i) => `Synthetic section ${i}. Unknowns remain unknown.`,
);
const content = `# ${template.title}\n\n${template.sections.map((title, i) => `## ${title}\n${bodies[i]}`).join('\n')}`;
const renderMessage = (
  message: Parameters<typeof ConversationMessage>[0]['message'],
) => (
  <ConversationMessage
    message={message}
    onOpenSource={jest.fn()}
    onLinkError={jest.fn()}
  />
);

/** These fixtures establish presentation only, never actual model compliance or clinical accuracy. */
test('complete explicit possibility sections render identically live and after retained restoration', async () => {
  const message = { id: 1, role: 'assistant' as const, content };
  const view = await render(renderMessage(message));
  expect(
    screen.getAllByRole('header').map(node => node.props.children),
  ).toEqual([template.title, ...template.sections]);
  for (const body of bodies) expect(screen.getByText(body)).toBeTruthy();
  const restored = conversationRestoredMessages(
    [
      {
        question: 'Synthetic',
        answer: content,
        citations: [],
        entryIntent: 'possibilities',
      },
    ],
    [[]],
    () => -1,
  )[1]!;
  expect(restored.content).toBe(content);
  await view.rerender(renderMessage(restored));
  expect(screen.getAllByRole('header')).toHaveLength(6);
  for (const body of bodies) expect(screen.getByText(body)).toBeTruthy();
});

test.each([
  content.replace(`## ${template.sections[1]}`, '## Unknown heading'),
  content.replace(`## ${template.sections[1]}`, `## ${template.sections[0]}`),
  content.slice(0, content.lastIndexOf('\n## ')),
  content.replace(bodies[2]!, ''),
  `${content}\n## Unexpected\nSynthetic extra`,
  'Ordinary prose discussing possible explanations.',
])(
  'malformed or legacy prose stays complete without invented report sections',
  async answer => {
    expect(parseConversationReport(answer)).toBeUndefined();
    await render(renderMessage({ id: 1, role: 'assistant', content: answer }));
    expect(screen.queryAllByRole('header')).toHaveLength(0);
    expect(screen.getByText(answer)).toBeTruthy();
  },
);

test.each([
  { role: 'user' as const },
  { role: 'assistant' as const, streaming: true },
  { role: 'assistant' as const, incomplete: true },
])(
  'does not promote user input or provisional output into a finished report',
  async state => {
    await render(renderMessage({ id: 1, content, ...state }));
    expect(screen.queryAllByRole('header')).toHaveLength(0);
    expect(screen.getByText(content)).toBeTruthy();
  },
);

test('template guidance belongs only to the explicit possibility quick choice, not follow-up or ordinary conversation', () => {
  const question = t('conversationIntent.possibilities');
  expect(
    conversationTaskInput(question, { intent: 'possibilities' }, [])
      .answerTemplate,
  ).toMatchObject({
    title: `# ${template.title}`,
    sections: template.sections.map(title => `## ${title}`),
  });
  expect(
    conversationTaskInput(
      'Synthetic follow-up',
      { intent: 'possibilities' },
      [],
    ).answerTemplate,
  ).toBeUndefined();
  expect(
    conversationTaskInput(question, { intent: 'conversation' }, [])
      .answerTemplate,
  ).toBeUndefined();
});

test('daily report preserves model order, limits and original text in reusable sections', async () => {
  const saved = {
    status: 'saved',
    context: {
      generationCutoff: '2035-01-01T12:00:00Z',
      identity: { timeZone: 'UTC' },
    },
    report: {
      coverage: [],
      supportedContext: [
        { section: 'priority', text: 'Synthetic priority' },
        { section: 'limits', text: 'Synthetic limitation' },
      ],
      observations: [{ text: 'Synthetic observed record' }],
      followUpQuestions: ['Synthetic follow-up question'],
    },
  } as unknown as Extract<DailyReportLookup, { status: 'saved' }>;
  const answer = conversationDailyReportText(saved);
  const parsed = parseConversationReport(answer);
  expect(parsed?.sections.map(section => section.title)).toEqual([
    t('dailyReport.analysis.priority'),
    t('dailyReport.analysis.limits'),
    t('dailyReport.observations'),
    t('dailyReport.suggestedQuestions'),
    t('conversationTemplate.daily.scope'),
  ]);
  expect(parsed?.sections.at(-1)?.content).toContain(
    t('dailyReport.reportCaution'),
  );
  const restored = conversationRestoredMessages(
    [{ question: 'Synthetic', answer, citations: [] }],
    [[]],
    () => -1,
  )[1]!;
  await render(renderMessage(restored));
  for (const text of [
    'Synthetic priority',
    'Synthetic limitation',
    'Synthetic observed record',
  ])
    expect(screen.getByText(text, { exact: false })).toBeTruthy();
  expect(screen.getAllByRole('header')).toHaveLength(6);
});

test('replacing or withholding the completed body removes every old report section', async () => {
  const view = await render(
    renderMessage({ id: 1, role: 'assistant', content }),
  );
  expect(screen.getAllByRole('header')).toHaveLength(6);
  for (const body of bodies) {
    const node = screen.getByText(body);
    expect(node.props.selectable).toBe(true);
    expect(node.props.numberOfLines).toBeUndefined();
  }
  await view.rerender(renderMessage({ id: 1, role: 'assistant', content: '' }));
  expect(screen.queryAllByRole('header')).toHaveLength(0);
  for (const body of bodies) expect(screen.queryByText(body)).toBeNull();
  await view.rerender(
    renderMessage({
      id: 2,
      role: 'assistant',
      content: 'Another session answer',
    }),
  );
  expect(screen.getByText('Another session answer')).toBeTruthy();
  expect(screen.queryAllByRole('header')).toHaveLength(0);
});
