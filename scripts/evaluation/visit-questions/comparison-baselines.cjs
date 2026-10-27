'use strict';

const { responseFor } = require('./scripted-provider.cjs');
const { createOpenAIChatCompletionsProvider } = require('./openai-api-provider.cjs');
const { toLangSmithOutput } = require('./privacy');
const {
  visitQuestionSystemPrompt,
  visitQuestionResultSchema,
} = require('../../../apps/mobile/src/agent/visitQuestions/taskPrompt');

/** One-shot baselines deliberately omit the graph's tool loop and output repair. */
async function runBaseline({ testCase, prepared, items, config, fetchImpl }) {
  const selected =
    config.mode === 'openai-api'
      ? createOpenAIChatCompletionsProvider({
          apiKey: config.apiKey,
          model: config.model,
          ...(fetchImpl ? { fetchImpl } : {}),
        })
      : {
          provider: {
            // This deterministic response is a protocol fixture, never model quality evidence.
            generate: async () => ({ ok: true, value: { text: responseFor(testCase, items) } }),
          },
          getTokenUsage: () => null,
        };
  const response = await selected.provider.generate({
    messages: [
      { role: 'system', content: visitQuestionSystemPrompt },
      {
        role: 'user',
        content: `Appointment and user context: ${JSON.stringify(prepared.appointmentContext)}\nEvidence: ${JSON.stringify(items)}\nReturn type=result, value matching the schema, and citations. No search tools are available in this one-shot baseline.`,
      },
    ],
    responseFormat: {
      schema: {
        type: 'object',
        required: ['type', 'value', 'citations'],
        properties: {
          type: { const: 'result' },
          value: visitQuestionResultSchema,
          citations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  });
  if (!response.ok) throw new Error(`Baseline provider failure: ${response.error.code}`);
  const envelope = JSON.parse(response.value.text);
  const value = envelope.type === 'result' ? envelope.value : null;
  if (!value || !['suggestions', 'needs_clarification'].includes(value.status)) {
    throw new Error('Baseline returned an invalid result envelope.');
  }
  const byId = new Map(items.map((item) => [item.evidenceId, item]));
  // Preserve unsupported IDs for the rubric instead of silently dropping hallucinated citations.
  const result =
    value.status === 'suggestions'
      ? {
          status: 'ready',
          questions: (value.questions ?? []).map((question) => ({
            ...question,
            citations: (question.evidenceIds ?? []).map((id) => byId.get(id) ?? { evidenceId: id }),
          })),
        }
      : value;
  return toLangSmithOutput(result, {
    providerMode: config.mode,
    tokenUsage: selected.getTokenUsage(),
  });
}

module.exports = { runBaseline };
