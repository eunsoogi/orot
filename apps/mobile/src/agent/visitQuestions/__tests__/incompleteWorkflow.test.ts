import { clarificationQuestions } from '../clarificationQuestions';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';

it('returns source-free clarification questions after a completed empty search', async () => {
  const base = preparedContext();
  const empty = {
    ...base.evidence,
    batch: { items: [], conflicts: [], coverage: [] },
    metadataByCitation: new Map(),
  };
  const searchEvidence = jest.fn(async () => ({
    ...empty,
    batch: {
      ...empty.batch,
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: [],
          gaps: [],
          truncated: false,
          resultLimit: 5,
          returnedCount: 0,
        },
      ],
    },
  }));
  const prepared = { ...base, evidence: empty, searchEvidence };
  const questions = clarificationQuestions.slice(0, 3).map(item => ({
    ...item,
    kind: 'clarification',
    priority: 'routine',
    evidenceIds: [],
  }));
  const { provider } = makeProvider([
    JSON.stringify({
      text: '',
      toolCalls: [
        {
          id: 'search',
          name: 'visit-question-personal-record-search',
          arguments: { query: '진료 기록' },
        },
      ],
      finishReason: 'tool_calls',
    }),
    JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions },
      citations: [],
    }),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
  });
  expect(searchEvidence).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected questions');
  expect(result.questions).toHaveLength(3);
  expect(
    result.questions.every(
      question =>
        question.kind === 'clarification' && question.citations.length === 0,
    ),
  ).toBe(true);
  expect(prepared.revalidateEvidence).toHaveBeenCalledWith([], {
    allowEmpty: true,
  });
});

it('preserves exact citations alongside clarification after partial retrieval', async () => {
  const base = preparedContext();
  const evidence = {
    ...base.evidence,
    batch: {
      ...base.evidence.batch,
      coverage: base.evidence.batch.coverage.map(item => ({
        ...item,
        gaps: ['Some records could not be read.'],
      })),
    },
  };
  const alias = createVisitQuestionEvidenceAliases(evidence.batch).batch
    .items[0]!;
  const questions = [
    {
      kind: 'confirmed_fact',
      questionText: '이 검사 기록을 진료에서 어떻게 확인할까요?',
      rationale: '기록된 검사 내용을 확인할 수 있어요.',
      priority: 'routine',
      evidenceIds: [alias.evidenceId],
    },
    ...clarificationQuestions.slice(0, 2).map(item => ({
      ...item,
      kind: 'clarification',
      priority: 'routine',
      evidenceIds: [],
    })),
  ];
  const { provider } = makeProvider([
    JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions },
      citations: [alias.evidenceId],
    }),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared: { ...base, evidence },
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected questions');
  expect(result.questions[0]?.citations).toEqual([base.initialEvidence]);
  expect(result.questions[1]).toMatchObject({
    kind: 'clarification',
    citations: [],
  });
});

it('offers clarification without asserting either side of a conflicting batch', async () => {
  const base = preparedContext();
  const evidence = {
    ...base.evidence,
    batch: {
      ...base.evidence.batch,
      conflicts: ['Values conflict at the same time.'],
    },
  };
  const questions = clarificationQuestions.slice(0, 3).map(item => ({
    ...item,
    kind: 'clarification',
    priority: 'routine',
    evidenceIds: [],
  }));
  const { provider } = makeProvider([
    JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions },
      citations: [],
    }),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared: { ...base, evidence },
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected questions');
  expect(
    result.questions.every(question => question.citations.length === 0),
  ).toBe(true);
});

it('corrects a mixed conflicting response into safe questions instead of discarding them', async () => {
  const base = preparedContext();
  const evidence = {
    ...base.evidence,
    batch: {
      ...base.evidence.batch,
      conflicts: ['Values conflict at the same time.'],
    },
  };
  const alias = createVisitQuestionEvidenceAliases(evidence.batch).batch
    .items[0]!;
  const safe = clarificationQuestions.slice(0, 3).map(item => ({
    ...item,
    kind: 'clarification',
    priority: 'routine',
    evidenceIds: [],
  }));
  const conflicting = {
    kind: 'confirmed_fact',
    questionText: '이 검사 결과를 확인할까요?',
    rationale: '검사 기록이 있어요.',
    priority: 'routine',
    evidenceIds: [alias.evidenceId],
  };
  const { provider, requests } = makeProvider([
    JSON.stringify({
      type: 'result',
      value: {
        status: 'suggestions',
        questions: [conflicting, ...safe.slice(0, 2)],
      },
      citations: [alias.evidenceId],
    }),
    JSON.stringify({
      type: 'result',
      value: { status: 'suggestions', questions: safe },
      citations: [],
    }),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared: { ...base, evidence },
    selection,
    providerOptions: [option],
  });
  expect(requests).toHaveLength(2);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected questions');
  expect(
    result.questions.every(
      question =>
        question.kind === 'clarification' && question.citations.length === 0,
    ),
  ).toBe(true);
});
