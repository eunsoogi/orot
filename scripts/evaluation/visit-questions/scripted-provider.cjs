'use strict';

const { buildSyntheticClarificationResponse } = require('./clarification-response.cjs');

/** Keeps fixture answers deterministic while following the app's task/research/task protocol. */
function responseFor(testCase, referencesByOriginalId) {
  const clarificationResponse = buildSyntheticClarificationResponse(testCase);
  if (clarificationResponse) return clarificationResponse;

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
          // The app validator matches source unit labels exactly; preserve them in the synthetic answer.
          questionText: '수면 기록의 7.5 hours와 450 minutes가 같은 기간을 가리키나요?',
          rationale: '두 합성 측정값이 같은 기간을 가리키는지 진료에서 확인할 수 있어요.',
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

function requestText(request) {
  return request.messages
    .map((message) =>
      message.role !== 'tool' && typeof message.content === 'string' ? message.content : '',
    )
    .join('\n');
}

function createScriptedProvider(testCase, finalResponse) {
  let calls = 0;
  let taskResponses = 0;
  const providerTurns = [];
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
    async generate(request) {
      calls += 1;
      const requestBody = requestText(request);

      if (requestBody.includes('Role: EvidenceResearcher')) {
        providerTurns.push('researcher-search');
        return {
          ok: true,
          value: {
            text: JSON.stringify({
              toolId: 'visit-question-personal-record-search',
              sourceKind: 'personal_record',
              input: { query: testCase.query },
            }),
            toolCalls: [],
            finishReason: 'complete',
          },
        };
      }
      if (testCase.expected.resultMode === 'suggestions' && taskResponses++ === 0) {
        providerTurns.push('request-search');
        return {
          ok: true,
          value: {
            text: JSON.stringify({
              type: 'request_evidence',
              need: 'missing_coverage',
            }),
            toolCalls: [],
            finishReason: 'complete',
          },
        };
      }
      providerTurns.push('scripted-result');
      return {
        ok: true,
        value: { text: finalResponse, toolCalls: [], finishReason: 'complete' },
      };
    },
  };

  return {
    provider,
    get callCount() {
      return calls;
    },
    providerTurns,
  };
}

module.exports = { createScriptedProvider, responseFor };
