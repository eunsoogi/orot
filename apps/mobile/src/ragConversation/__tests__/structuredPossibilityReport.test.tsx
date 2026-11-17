import {
  answer,
  record,
  input,
} from '../testSupport/structuredPossibilityReportFixture';
import { render, screen } from '@testing-library/react-native';
import { ragConversationTask, legacyTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { requestsPossibilityReport } from '../structuredPossibilityReport';
import {
  possibilityReportTemplate,
  parseConversationReport,
} from '../conversationReportTemplate';
import { ConversationMessage } from '../ConversationMessage';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import { t } from '../../i18n';

test('visible typed action and actual choice request get a structured contract, but follow-ups do not', () => {
  expect(requestsPossibilityReport(input)).toBe(true);
  expect(
    requestsPossibilityReport({
      request: t('conversationIntent.possibilities'),
      context: { intent: 'possibilities' },
    }),
  ).toBe(true);
  expect(requestsPossibilityReport({ ...input, request: 'What else?' })).toBe(
    false,
  );
  const schema = ragConversationTask.createResultSchema!(input);
  expect(schema).toHaveProperty('properties.answer.anyOf');
  const message = ragConversationTask.createMessages(input)[0]!;
  if (message.role !== 'user') throw new Error('Expected task input');
  expect(JSON.parse(message.content as string).answerTemplate.format).toContain(
    'must be an object',
  );
  expect(
    ragConversationTask.createResultSchema!({
      ...input,
      request: 'What else?',
    }),
  ).toEqual(legacyTask.createResultSchema!(input));
});

test('structured output is converted to app-owned headings, retained identically and rendered as report sections', async () => {
  const validated = ragConversationTask.validateResult(
    { answerKind: 'grounded', answer },
    input,
  );
  expect(validated.status).toBe('valid');
  if (validated.status !== 'valid') throw new Error('Expected report');
  expect(
    parseConversationReport(validated.value.answer)?.sections.map(s =>
      s.content.trim(),
    ),
  ).toEqual(Object.values(answer));
  const messages = conversationRestoredMessages(
    [
      {
        question: input.request,
        answer: validated.value.answer,
        citations: [],
        entryIntent: 'possibilities',
      },
    ],
    [[]],
    () => -1,
  );
  await render(
    <ConversationMessage
      message={messages[1]!}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(screen.getAllByRole('header').map(n => n.props.children)).toEqual([
    possibilityReportTemplate().title,
    ...possibilityReportTemplate().sections,
  ]);
  for (const text of Object.values(answer))
    expect(screen.getByText(text, { exact: false })).toBeTruthy();
});

test.each([
  { answerKind: 'grounded', answer: 'Unstructured grounded answer.' },
  { answerKind: 'grounded', answer: { ...answer, unknowns: '' } },
  {
    answerKind: 'grounded',
    answer: { ...answer, nextSteps: '약물 용량을 늘리세요.' },
  },
])(
  'does not silently publish an invalid structured result or bypass clinical validation',
  value => {
    expect(ragConversationTask.validateResult(value, input).status).toBe(
      'invalid',
    );
  },
);

test('clarification stays plain, and old v14 checkpoints keep their exact prose contract', () => {
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'conversation', answer: '어떤 내용을 원하시나요?' },
      input,
    ),
  ).toMatchObject({
    status: 'valid',
    value: { answer: '어떤 내용을 원하시나요?' },
  });
  const old = restoreConversationTask({
    taskType: legacyTask.taskType,
    taskVersion: '14',
  })!;
  expect(old).toBe(legacyTask);
  expect(old.createMessages(input)).toEqual(legacyTask.createMessages(input));
  expect(old.createResultSchema!(input)).toEqual(
    legacyTask.createResultSchema!(input),
  );
  expect(
    old.validateResult(
      { answerKind: 'grounded', answer: 'Synthetic prose.' },
      input,
    ).status,
  ).toBe('valid');
});

test('exact-source composition gets a report without resurrecting discarded model claims', () => {
  const validated = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: 'Discarded unsupported prose',
      localClaims: [
        {
          evidenceId: record.evidenceId,
          sourceRevision: record.sourceRevision,
          evidenceRevision: record.evidenceRevision,
          span: record.content,
        },
      ],
    },
    input,
  );
  expect(validated.status).toBe('valid');
  if (validated.status !== 'valid') throw new Error('Expected report');
  const report = parseConversationReport(validated.value.answer)!;
  expect(report.sections).toHaveLength(1);
  expect(report.sections[0]!.content).toContain(record.content);
  expect(validated.value.answer).not.toContain('Discarded');
});

test('literal source headings cannot reclassify or drop source content', () => {
  const source = {
    ...record,
    content: `Synthetic source text\n## ${t('conversationTemplate.possibilities.records')}\nAnother literal source heading`,
  };
  const validated = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      localClaims: [
        {
          evidenceId: source.evidenceId,
          sourceRevision: source.sourceRevision,
          evidenceRevision: source.evidenceRevision,
          span: source.content,
        },
      ],
    },
    { ...input, evidence: { ...input.evidence, items: [source] } },
  );
  if (validated.status !== 'valid') throw new Error('Expected source report');
  const report = parseConversationReport(validated.value.answer)!;
  expect(report.sections).toHaveLength(1);
  expect(report.sections[0]!.title).toBe(
    t('conversationTemplate.possibilities.verifiedSources'),
  );
  expect(report.sections[0]!.content).toContain(source.content);
});
