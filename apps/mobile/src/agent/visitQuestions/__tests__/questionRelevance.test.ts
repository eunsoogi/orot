import { t } from '../../../i18n';
import { clarificationQuestionsForEvidence } from '../clarificationQuestions';
import { createVisitQuestionTaskResponder } from '../taskContract';
import type { VisitQuestionResponderInput } from '../taskContract';
import { validateVisitQuestionTaskResult } from '../taskValidation';

const input: VisitQuestionResponderInput = {
  request: '다음 진료에서 상의할 내용을 준비해 줘',
  evidence: { items: [], coverage: [], conflicts: [] },
};
const responder = createVisitQuestionTaskResponder();

/** Synthetic contract checks prove which safe choices the model receives, not its prose quality. */
test.each([false, true])(
  'offers practical non-assertive questions with conflicts=%s',
  hasConflicts => {
    const options = clarificationQuestionsForEvidence(hasConflicts);
    const topics = [
      'careOptions',
      'symptomReview',
      'testingPurpose',
      'carePlan',
    ];
    expect(options.slice(0, 4).map(item => item.questionText)).toEqual(
      topics.map(topic =>
        t(
          `nextVisit.clarification.${topic}.question` as Parameters<
            typeof t
          >[0],
        ),
      ),
    );
    const request = {
      ...input,
      evidence: {
        ...input.evidence,
        conflicts: hasConflicts ? ['Synthetic conflict'] : [],
      },
    };
    const first = responder.createMessages(request)[0]!;
    const message =
      'content' in first && typeof first.content === 'string'
        ? first.content
        : '';
    expect(message).toContain(JSON.stringify(options));
    expect(message).not.toContain(
      t('nextVisit.clarification.unconfirmedResults.question'),
    );
    expect(
      message.includes(
        t('nextVisit.clarification.conflictingRecords.question'),
      ),
    ).toBe(hasConflicts);
    const result = validateVisitQuestionTaskResult(
      {
        status: 'suggestions',
        questions: options.slice(0, 4).map(pair => ({
          ...pair,
          kind: 'clarification',
          priority: 'routine',
          evidenceIds: [],
        })),
      },
      request,
    );
    expect(result.status).toBe('valid');
    if (result.status === 'valid' && result.value.status === 'suggestions')
      expect(
        result.value.questions.every(
          question => question.citations.length === 0,
        ),
      ).toBe(true);
  },
);

test('partial coverage alone does not offer record-conflict or unconfirmed-result interrogation', () => {
  const request = {
    ...input,
    evidence: {
      ...input.evidence,
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: [],
          gaps: ['Synthetic unavailable source'],
          truncated: true,
          resultLimit: 3,
          returnedCount: 0,
        },
      ],
    },
  };
  const first = responder.createMessages(request)[0]!;
  const message =
    'content' in first && typeof first.content === 'string'
      ? first.content
      : '';
  expect(message).not.toContain(
    t('nextVisit.clarification.conflictingRecords.question'),
  );
  expect(message).not.toContain(
    t('nextVisit.clarification.unconfirmedResults.question'),
  );
});

test('relevance instructions preserve important discrepancies and forbid invented clinical context', () => {
  expect(responder.systemPrompt).toContain(
    'treatment or management options and tradeoffs',
  );
  expect(responder.systemPrompt).toContain(
    'Do not force every category or invent',
  );
  expect(responder.systemPrompt).toContain(
    'do not suppress clinically important discrepancies',
  );
  expect(responder.systemPrompt).toContain(
    'A missing source or incomparable measurement alone is not a contradiction',
  );
});

test('useful-question options do not admit fabricated clinical facts or medication instructions', () => {
  const safe = clarificationQuestionsForEvidence(false)
    .slice(0, 3)
    .map(pair => ({
      ...pair,
      kind: 'clarification',
      priority: 'routine',
      evidenceIds: [],
    }));
  for (const questionText of [
    '제가 복용 중인 아스피린을 중단하세요?',
    '검사 수치가 123 mg/dL인데 치료해야 하나요?',
  ]) {
    const result = validateVisitQuestionTaskResult(
      {
        status: 'suggestions',
        questions: [{ ...safe[0], questionText }, ...safe.slice(1)],
      },
      input,
    );
    expect(result.status).toBe('invalid');
  }
});

// This proves delivered task instructions, not actual model adherence or clinical quality.
test('contextualizes heart-rate questions without asserting exercise causation or rest', () => {
  expect(responder.systemPrompt).toContain(
    'use the returned activityContext groups alongside the full range',
  );
  expect(responder.systemPrompt).toContain(
    'not that exercise caused the value or that it is normal',
  );
  expect(responder.systemPrompt).toContain(
    'no_recorded_workout_overlap is not resting heart rate',
  );
  expect(responder.systemPrompt).toContain(
    'never inactivity or denied permission',
  );
  expect(responder.systemPrompt).toContain(
    'discard samples or invent thresholds',
  );
});
