'use strict';

const path = require('node:path');
const { toLangSmithOutput } = require('./privacy');
const { buildSyntheticClarificationResponse } = require('./clarification-response.cjs');

const FIXTURE_SEED = 'orot-visit-questions-eval-v1';
const repositoryRoot = path.resolve(__dirname, '../../..');

function referenceMapForEvidence(testCase, aliasBatch) {
  return new Map(
    testCase.evidence.map((item, index) => {
      const alias = aliasBatch.items[index];
      if (!alias) throw new Error('Synthetic fixture evidence alias is missing.');
      return [
        item.evidenceId,
        {
          sourceKind: alias.sourceKind,
          sourceId: alias.sourceId,
          sourceRevision: alias.sourceRevision,
          evidenceId: alias.evidenceId,
          evidenceRevision: alias.evidenceRevision,
          locator: alias.locator,
          effectiveTime: alias.effectiveTime,
          reviewState: alias.reviewState,
        },
      ];
    }),
  );
}

function responseFor(testCase, referencesByOriginalId) {
  const clarificationResponse = buildSyntheticClarificationResponse(testCase);
  if (clarificationResponse) return clarificationResponse;

  if (testCase.expected.resultMode === 'suggestions') {
    const referenceFor = (suffix) => {
      const original = testCase.evidence.find((item) => item.evidenceId.endsWith(suffix));
      const reference = original && referencesByOriginalId.get(original.evidenceId);
      if (!reference) throw new Error('Synthetic response evidence is missing.');
      return reference;
    };
    const appointment = referenceFor(':evidence-appointment-rescheduled');
    const sleepHours = referenceFor(':evidence-sleep-hours');
    const memory = referenceFor(':evidence-reviewed-memory-visit-intent');
    const minutes = referenceFor(':evidence-sleep-minutes');
    return JSON.stringify({
      type: 'result',
      value: {
        status: 'suggestions',
        questions: [
          {
            questionText: '다음 진료 2030-05-09에 수면 기록을 함께 살펴볼까요?',
            rationale: '합성 메모리와 수면 기록을 진료에서 확인할 수 있어요.',
            priority: 'routine',
            evidenceIds: [appointment.evidenceId, memory.evidenceId],
          },
          {
            questionText: '수면 기록의 7.5시간과 450분은 같은 기간을 가리키나요?',
            rationale: '두 합성 측정값의 단위를 진료에서 확인할 수 있어요.',
            priority: 'routine',
            evidenceIds: [sleepHours.evidenceId, minutes.evidenceId],
          },
          {
            questionText: '수면 기록에서 진료 때 확인할 내용을 정리할까요?',
            rationale: '검토된 합성 메모리의 관심 내용을 준비할 수 있어요.',
            priority: 'important',
            evidenceIds: [memory.evidenceId],
          },
        ],
      },
      citations: [appointment, memory, sleepHours, minutes],
    });
  }

  const citation = referencesByOriginalId.get(testCase.evidence[0].evidenceId);
  if (!citation) throw new Error('Synthetic response evidence is missing.');
  const questions = [
    {
      questionText: '현재 복용 정보를 의료진과 확인할까요?',
      rationale: '기록 차이를 임의로 해석하지 않고 확인할 수 있어요.',
      priority: 'important',
      evidenceIds: [citation.evidenceId],
    },
    {
      questionText: '진료에서 확인할 기록 차이를 함께 정리할까요?',
      rationale: '서로 다른 합성 기록을 확인 대상으로 남길 수 있어요.',
      priority: 'routine',
      evidenceIds: [citation.evidenceId],
    },
    {
      questionText: '누구와 현재 기록을 다시 확인하면 좋을까요?',
      rationale: '불확실한 합성 기록에 대해 의료진에게 물을 수 있어요.',
      priority: 'routine',
      evidenceIds: [citation.evidenceId],
    },
  ];
  return JSON.stringify({
    type: 'result',
    value: { status: 'suggestions', questions },
    citations: [citation],
  });
}

/** Builds the app's ready-context boundary only from generated fixture values. */
function makePreparedContext(testCase) {
  const evidence = testCase.evidence.map((item) => ({ ...item }));
  const byIdentity = new Set(
    evidence.map((item) =>
      [
        item.sourceKind,
        item.sourceId,
        item.sourceRevision,
        item.evidenceId,
        item.evidenceRevision,
      ].join('\u0000'),
    ),
  );
  const personal = evidence.filter((item) => item.sourceKind === 'personal_record');
  const memories = evidence.filter((item) => item.sourceKind === 'reviewed_memory');
  const coverage = [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [...new Set(personal.map((item) => item.sourceId))],
      gaps: [...testCase.coverageGaps],
      truncated: false,
      resultLimit: 8,
      returnedCount: personal.length,
    },
    {
      sourceKind: 'reviewed_memory',
      searchedSourceIds: [...new Set(memories.map((item) => item.sourceId))],
      gaps: [],
      truncated: false,
      resultLimit: 8,
      returnedCount: memories.length,
    },
  ];
  const emptySearch = async (_query, maxEvidenceItems, sourceKind) => ({
    batch: {
      items: [],
      coverage: [
        {
          sourceKind,
          searchedSourceIds: [],
          gaps: [],
          truncated: false,
          resultLimit: maxEvidenceItems,
          returnedCount: 0,
        },
      ],
      conflicts: [],
    },
    metadataByCitation: new Map(),
    memoryStatus: memories.length ? 'available' : 'no_matching_current_memory',
  });

  return {
    status: 'ready',
    appointment: testCase.appointment,
    appointmentRevision: 'synthetic-appointment-revision-v1',
    appointmentContext: testCase.appointmentContext,
    query: testCase.query,
    evidence: {
      batch: { items: evidence, coverage, conflicts: [...testCase.conflicts] },
      metadataByCitation: new Map(),
      memoryStatus: memories.length ? 'available' : 'no_matching_current_memory',
    },
    searchEvidence: emptySearch,
    revalidateEvidence: async (references) =>
      references.every((item) =>
        byIdentity.has(
          [
            item.sourceKind,
            item.sourceId,
            item.sourceRevision,
            item.evidenceId,
            item.evidenceRevision,
          ].join('\u0000'),
        ),
      ),
  };
}

/** Runs the real app graph with a deterministic adapter and reports its wall-clock latency. */
async function runSyntheticCase(testCase) {
  const workflowPath = path.join(repositoryRoot, 'apps/mobile/src/agent/visitQuestions/workflow');
  const { runVisitQuestionWorkflow } = require(workflowPath);
  const { createVisitQuestionEvidenceAliases } = require(
    path.join(repositoryRoot, 'apps/mobile/src/agent/visitQuestions/evidenceAliases'),
  );
  const prepared = makePreparedContext(testCase);
  const aliases = createVisitQuestionEvidenceAliases(prepared.evidence.batch);
  const references = referenceMapForEvidence(testCase, aliases.batch);
  const response = responseFor(testCase, references);
  let calls = 0;
  const provider = {
    kind: 'language-model',
    id: 'orot-synthetic-evaluation-adapter',
    displayName: 'Synthetic evaluation adapter',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate() {
      calls += 1;
      return {
        ok: true,
        value: { text: response, toolCalls: [], finishReason: 'complete' },
      };
    },
  };
  const selection = {
    providerId: provider.id,
    modelId: 'synthetic-scripted-v1',
  };
  const startedAt = process.hrtime.bigint();
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [
      {
        provider,
        modelId: selection.modelId,
        displayName: provider.displayName,
        privacyBoundary: 'on-device',
        availability: { status: 'available' },
      },
    ],
  });
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  if (calls !== 1) {
    throw new Error('The scripted test adapter received an unexpected model-call count.');
  }
  return toLangSmithOutput(result, {
    providerMode: 'test-adapter',
    latencyMs,
    tokenUsage: null,
  });
}

module.exports = { FIXTURE_SEED, runSyntheticCase };
