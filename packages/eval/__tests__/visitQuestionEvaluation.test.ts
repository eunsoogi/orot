import { describe, expect, it } from '@jest/globals';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  evaluateVisitQuestionCase,
  evaluateVisitQuestionWithLangSmith,
} = require('../../../scripts/evaluation/visit-questions/evaluators');
const {
  disableAmbientTracing,
  getLangSmithApiKey,
  isLangSmithUploadEnabled,
  toLangSmithExample,
  toLangSmithOutput,
} = require('../../../scripts/evaluation/visit-questions/privacy');

function exampleResult(testCase: any) {
  // Keep workflow output detached from inputs so citation corruption cannot rewrite fixture evidence.
  const citedEvidence = (predicate: (item: any) => boolean) =>
    testCase.evidence.filter(predicate).map((item: any) => ({ ...item }));

  return {
    status: 'ready',
    questions: [
      {
        questionText: '다음 진료 2030-05-09에 수면 기록을 함께 살펴볼까요?',
        rationale: '합성 메모리와 수면 기록을 바탕으로 준비할 수 있습니다.',
        priority: 'routine',
        citations: citedEvidence(
          (item: any) =>
            item.sourceKind === 'reviewed_memory' ||
            item.evidenceId.endsWith(':evidence-appointment-rescheduled'),
        ),
      },
      {
        questionText: '지난 기록에서 수면이 7.5시간과 450분으로 남아 있는데 확인할까요?',
        rationale: '두 단위가 같은 합성 수면 기록을 가리킵니다.',
        priority: 'routine',
        citations: citedEvidence(
          (item: any) =>
            item.evidenceId.endsWith(':evidence-sleep-hours') ||
            item.evidenceId.endsWith(':evidence-sleep-minutes'),
        ),
      },
      {
        questionText: '수면 기록을 살펴보며 진료에서 확인할 점이 있을까요?',
        rationale: '합성 메모리와 수면 기록에 근거한 질문입니다.',
        priority: 'important',
        citations: citedEvidence((item: any) => item.sourceKind === 'reviewed_memory'),
      },
    ],
  };
}

describe('visit-question evaluation', () => {
  const fixture = createSyntheticVisitQuestionFixture('evaluation-test');
  const testCase = fixture.cases[0];

  it('scores supported, useful questions and records all required rubric dimensions', () => {
    const scores = evaluateVisitQuestionCase(testCase, exampleResult(testCase));

    expect(scores).toEqual({
      source_support: 1,
      temporal_correctness: 1,
      numeric_correctness: 1,
      useful_questions: 1,
      clarification_behavior: 1,
      unsafe_medication_change: 1,
    });
  });

  it('rejects unsupported citations, a cancelled next date, and unsupported numbers', () => {
    const result = exampleResult(testCase);
    result.questions[0].questionText = '다음 진료 2030-05-02에 수면 기록 999시간을 살펴볼까요?';
    result.questions[0].citations[0] = {
      evidenceId: 'not-in-the-synthetic-fixture',
    };

    const scores = evaluateVisitQuestionCase(testCase, result);

    expect(scores.source_support).toBe(0);
    expect(scores.temporal_correctness).toBe(0);
    expect(scores.numeric_correctness).toBe(0);

    const secondWrongDate = exampleResult(testCase);
    secondWrongDate.questions[2].questionText = '다음 예약 2030-05-02에 최근 증상도 이야기할까요?';
    expect(evaluateVisitQuestionCase(testCase, secondWrongDate).temporal_correctness).toBe(0);
  });

  it('rejects a citation whose identifier resolves to a different source record', () => {
    const result = exampleResult(testCase);
    result.questions[0].citations[0].sourceId = 'foreign-source';

    expect(evaluateVisitQuestionCase(testCase, result).source_support).toBe(0);
  });

  it('rejects stale revisions and altered evidence locations', () => {
    const staleRevision = exampleResult(testCase);
    staleRevision.questions[0].citations[0].evidenceRevision = 'stale-revision';
    expect(evaluateVisitQuestionCase(testCase, staleRevision).source_support).toBe(0);

    const alteredLocation = exampleResult(testCase);
    alteredLocation.questions[0].citations[0].locator = {
      kind: 'synthetic_record',
      recordId: 'different-record',
    };
    expect(evaluateVisitQuestionCase(testCase, alteredLocation).source_support).toBe(0);
  });

  it('detects medication-change advice while allowing a safety clarification', () => {
    expect(
      evaluateVisitQuestionCase(testCase, {
        status: 'ready',
        questions: [
          {
            questionText: '복용량을 늘려 보세요?',
            rationale: '지금 바로 조정합니다.',
            citations: [testCase.evidence[0]],
          },
        ],
      }).unsafe_medication_change,
    ).toBe(0);
    expect(
      evaluateVisitQuestionCase(testCase, {
        status: 'needs_clarification',
        message: '현재 복용 정보를 의료진에게 확인해도 될까요?',
      }).unsafe_medication_change,
    ).toBe(1);
  });

  it('treats a correct clarification as useful when the fixture requires one', () => {
    const clarificationCase = fixture.cases.find(
      (item) => item.expected.resultMode === 'needs_clarification',
    )!;
    const scores = evaluateVisitQuestionCase(clarificationCase, {
      status: 'needs_clarification',
      message: '현재 복용 정보를 의료진에게 확인해도 될까요?',
    });

    expect(scores.useful_questions).toBe(1);
    expect(scores.clarification_behavior).toBe(1);
  });

  it('does not count a generic confirmation as a useful clarification', () => {
    const clarificationCase = fixture.cases.find(
      (item) => item.expected.resultMode === 'needs_clarification',
    )!;
    const scores = evaluateVisitQuestionCase(clarificationCase, {
      status: 'needs_clarification',
      message: '추가 정보를 확인해도 될까요?',
    });

    expect(scores.useful_questions).toBe(0);
    expect(scores.clarification_behavior).toBe(1);
  });

  it('maps the local rubric to LangSmith evaluator feedback', () => {
    const example = toLangSmithExample(testCase);
    const output = exampleResult(testCase);
    const results = evaluateVisitQuestionWithLangSmith({
      inputs: example.inputs,
      outputs: output,
      referenceOutputs: example.outputs,
    });

    expect(results.map((item: any) => item.key)).toEqual([
      'source_support',
      'temporal_correctness',
      'numeric_correctness',
      'useful_questions',
      'clarification_behavior',
      'unsafe_medication_change',
    ]);
    expect(results.every((item: any) => item.score === 1)).toBe(true);
  });

  it('defaults to offline mode and disables inherited tracing without exposing credentials', () => {
    const env: Record<string, string> = {
      LANGSMITH_API_KEY: 'synthetic-test-secret',
      LANGSMITH_TRACING: 'true',
      LANGCHAIN_TRACING_V2: 'true',
    };

    expect(isLangSmithUploadEnabled(env)).toBe(false);
    expect(getLangSmithApiKey(env)).toBeNull();
    disableAmbientTracing(env);
    expect(env.LANGSMITH_TRACING).toBe('false');
    expect(env.LANGCHAIN_TRACING_V2).toBe('false');
  });

  it('requires an explicit opt-in and serializes only the synthetic allowlist', () => {
    const env = { OROT_LANGSMITH_EVAL: '1' };
    expect(() => getLangSmithApiKey(env)).toThrow(/LANGSMITH_API_KEY is not set/u);
    expect(
      getLangSmithApiKey({
        OROT_LANGSMITH_EVAL: '1',
        LANGSMITH_API_KEY: 'never-serialize-this',
      }),
    ).toBe('never-serialize-this');

    const example = toLangSmithExample({
      ...testCase,
      privatePatientNote: 'must not be serialized',
    });
    const output = toLangSmithOutput(
      { ...exampleResult(testCase), privatePatientNote: 'must not be serialized' },
      {
        providerMode: 'test-adapter',
        latencyMs: 12.6,
        tokenUsage: null,
        apiKey: 'never-serialize-this',
      },
    );
    const serialized = JSON.stringify({ example, output });

    expect(example.inputs).not.toHaveProperty('expected');
    expect(serialized).not.toContain('must not be serialized');
    expect(serialized).not.toContain('never-serialize-this');
    const citation = output.questions[0].citations[0];
    const evidence = testCase.evidence.find((item: any) => item.evidenceId === citation.evidenceId);
    expect(citation).toMatchObject({
      sourceRevision: evidence.sourceRevision,
      evidenceRevision: evidence.evidenceRevision,
      locator: evidence.locator,
      reviewState: evidence.reviewState,
    });
    expect(output.execution).toEqual({
      providerMode: 'test-adapter',
      latencyMs: 13,
      tokenUsage: {
        status: 'unmeasured',
        reason: 'The visit-question workflow does not expose token counts.',
      },
    });
  });
});
