'use strict';

const { buildSyntheticClarificationResponse } = require('./clarification-response.cjs');

function parsedToolResult(message) {
  if (typeof message.result !== 'string') return message.result;
  try {
    return JSON.parse(message.result);
  } catch {
    return undefined;
  }
}

function appointmentContextFromRequest(request) {
  const prefix = 'Appointment and user context: ';
  const content = request.messages.find(
    (message) => message.role === 'user' && message.content?.includes(prefix),
  )?.content;
  const contextLine = content?.split('\n').find((line) => line.startsWith(prefix));
  if (!contextLine) throw new Error('The model request omitted the appointment context.');
  return JSON.parse(contextLine.slice(prefix.length));
}

// The standard app tool message carries an EvidenceBatch directly in this harness's default result mode.
function searchedKinds(request) {
  return new Set(
    request.messages.flatMap((message) => {
      if (message.role !== 'tool') return [];
      const result = parsedToolResult(message);
      return Array.isArray(result?.coverage)
        ? result.coverage.map((coverage) => coverage.sourceKind)
        : [];
    }),
  );
}

function evidenceFromRequest(request) {
  return request.messages.flatMap((message) => {
    if (message.role !== 'tool') return [];
    const result = parsedToolResult(message);
    return Array.isArray(result?.items) ? result.items : [];
  });
}

// Keep failure diagnostics to tool names and evidence-batch metadata; fixture content stays out of logs.
function toolResultSummary(request) {
  return request.messages.flatMap((message) => {
    if (message.role !== 'tool') return [];
    const result = parsedToolResult(message);
    return [
      {
        resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
        itemCount: Array.isArray(result?.items) ? result.items.length : null,
        coverage: Array.isArray(result?.coverage)
          ? result.coverage.map((item) => ({
              sourceKind: item.sourceKind,
              returnedCount: item.returnedCount,
              gapCount: Array.isArray(item.gaps) ? item.gaps.length : null,
              truncated: item.truncated,
            }))
          : null,
        conflictCount: Array.isArray(result?.conflicts) ? result.conflicts.length : null,
      },
    ];
  });
}

// Compare required citations by source kind and content without logging fixture payloads.
function citationAvailability(testCase, evidenceItems) {
  const requiredSuffixes = [
    ':evidence-appointment-rescheduled',
    ':evidence-sleep-hours',
    ':evidence-reviewed-memory-visit-intent',
    ':evidence-sleep-minutes',
  ];
  return requiredSuffixes.map((suffix) => {
    const expected = testCase.evidence.find((item) => item.evidenceId.endsWith(suffix));
    const candidates = evidenceItems.filter((item) => item.content === expected?.content);
    return {
      suffix,
      expectedPresent: Boolean(expected),
      sourceKindMatches: evidenceItems.some((item) => item.sourceKind === expected?.sourceKind),
      contentMatches: candidates.length > 0,
      exactMatch: candidates.some((item) => item.sourceKind === expected?.sourceKind),
    };
  });
}

/** Cites only opaque references returned by the runtime's actual evidence-search tool messages. */
function responseFor(testCase, evidenceItems) {
  const clarification = buildSyntheticClarificationResponse(testCase);
  if (clarification) return clarification;

  const availability = citationAvailability(testCase, evidenceItems);
  const missing = availability.filter((item) => !item.exactMatch);
  if (missing.length > 0) {
    throw new Error(`Required synthetic citations were not returned: ${JSON.stringify(missing)}.`);
  }

  const referenceFor = (suffix) => {
    const expected = testCase.evidence.find((item) => item.evidenceId.endsWith(suffix));
    const reference =
      expected &&
      evidenceItems.find(
        (item) => item.sourceKind === expected.sourceKind && item.content === expected.content,
      );
    if (!reference) throw new Error('The runtime did not return a required synthetic citation.');
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
    // Let the shared runtime bind each opaque ID to the active batch's exact provenance reference.
    citations: [appointment, memory, sleepHours, minutes].map((item) => item.evidenceId),
  });
}

function createScriptedProvider(testCase) {
  let calls = 0;
  const providerTurns = [];
  const providerInputs = [];
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
      const appointmentContext = appointmentContextFromRequest(request);
      const query = appointmentContext.note;
      if (query !== testCase.query) {
        throw new Error('The model-facing appointment note does not match the fixture query.');
      }
      providerInputs.push({ query, appointmentContext });
      const kinds = searchedKinds(request);
      const toolResults = toolResultSummary(request);
      const offeredTools = (request.tools ?? []).map((tool) => tool.name);
      const nextSource = !kinds.has('personal_record')
        ? 'personal_record'
        : testCase.expected.resultMode === 'suggestions' && !kinds.has('reviewed_memory')
          ? 'reviewed_memory'
          : undefined;
      if (nextSource) {
        const name =
          nextSource === 'personal_record'
            ? 'visit-question-personal-record-search'
            : 'visit-question-reviewed-memory-search';
        if (!offeredTools.includes(name)) {
          providerTurns.push(JSON.stringify({ missingTool: name, offeredTools, toolResults }));
          throw new Error(`The standard runtime did not offer ${name}.`);
        }
        providerTurns.push(JSON.stringify({ requestedTool: name, offeredTools, toolResults }));
        return {
          ok: true,
          value: {
            text: '',
            toolCalls: [{ id: `synthetic-tool-call-${calls}`, name, arguments: { query } }],
            finishReason: 'tool_calls',
          },
        };
      }
      const items = evidenceFromRequest(request);
      providerTurns.push(
        JSON.stringify({
          requestedTool: 'final-answer',
          offeredTools,
          toolResults,
          citationAvailability: citationAvailability(testCase, items),
        }),
      );
      return {
        ok: true,
        value: {
          text: responseFor(testCase, items),
          toolCalls: [],
          finishReason: 'complete',
        },
      };
    },
  };

  return {
    provider,
    providerInputs,
    get callCount() {
      return calls;
    },
    providerTurns,
  };
}

module.exports = {
  citationAvailability,
  createScriptedProvider,
  evidenceFromRequest,
  responseFor,
  toolResultSummary,
};
