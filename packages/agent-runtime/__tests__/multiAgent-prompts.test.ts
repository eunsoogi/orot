import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import type { TaskResponderContract } from '../src';
import { buildResearchRequest, buildTaskRequest } from '../src/multiAgent/requests';
import { formatPromptMessages } from '../src/multiAgent/prompts';

function provider(): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'prompt-fixture',
    displayName: 'Prompt fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
      requestControls: ['maxOutputTokens', 'temperature'],
    },
    generate: async () => {
      throw new Error('Request formatting must not dispatch a model call.');
    },
  };
}

test('keeps JSON braces and standard message objects opaque in the message placeholder', async () => {
  const systemPrompt = 'Preserve JSON {"record":{"value":"{literal}"}} exactly.';
  const assistant = new AIMessage({
    id: 'assistant-message',
    content: '',
    tool_calls: [
      { type: 'tool_call', id: 'call_preserved', name: 'lookup', args: { query: 'source-1' } },
    ],
  });
  const tool = new ToolMessage({
    id: 'tool-message',
    tool_call_id: 'call_preserved',
    content: '{"evidenceId":"source-{id}"}',
  });
  const human = new HumanMessage('Check the literal token {patientName}.');
  const nestedSystem = new SystemMessage('Keep this JSON {"status":"scheduled"}.');

  const formatted = await formatPromptMessages(systemPrompt, [
    assistant,
    tool,
    human,
    nestedSystem,
  ]);

  expect(formatted.map((message) => message.type)).toEqual([
    'system',
    'ai',
    'tool',
    'human',
    'system',
  ]);
  expect(formatted[0]?.content).toBe(systemPrompt);
  expect(formatted[1]).toBe(assistant);
  expect(formatted[2]).toBe(tool);
  expect(formatted[3]).toBe(human);
  expect(formatted[4]).toBe(nestedSystem);
  expect(assistant.tool_calls[0]?.id).toBe('call_preserved');
  expect(tool.tool_call_id).toBe('call_preserved');
  expect(tool.content).toBe('{"evidenceId":"source-{id}"}');
});

test('formats task instructions without changing health evidence, roles, or request controls', async () => {
  const userPrompt = JSON.stringify({
    question: '요청한 복용 약을 확인해 주세요.',
    evidence: [{ evidenceId: 'evidence-{id}', content: '{"dose":{"value":"{dose}"}}' }],
  });
  const nestedSystem = 'Keep the record JSON {"appointment":{"state":"scheduled"}} literal.';
  const task: TaskResponderContract<{ answer: string }> = {
    taskType: 'health-record-summary',
    taskVersion: '1',
    systemPrompt:
      'Use only supplied health evidence. Preserve {patientName} and {"kind":"record"}.',
    resultSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
    createMessages: () => [
      { role: 'user', content: userPrompt },
      { role: 'system', content: nestedSystem },
      { role: 'user', content: 'State uncertainty when the record does not answer the question.' },
    ],
    validateResult: (value) => ({ status: 'valid', value }),
  };
  const built = await buildTaskRequest(
    provider(),
    task,
    {
      request: 'Summarize the current evidence.',
      evidence: { items: [], coverage: [], conflicts: [] },
    },
    DEFAULT_MULTI_AGENT_BUDGET,
  );

  if (built.status !== 'ready') throw new Error('Expected a formatted task request.');
  expect(built.request.messages.map((message) => message.role)).toEqual([
    'system',
    'user',
    'system',
    'user',
    'user',
    'user',
  ]);
  expect(built.request.messages[0]?.content).toContain(
    'Use only supplied health evidence. Preserve {patientName} and {"kind":"record"}.',
  );
  expect(built.request.messages[1]?.content).toBe(userPrompt);
  expect(built.request.messages[2]?.content).toBe(nestedSystem);
  expect(built.request.messages[3]?.content).toBe(
    'State uncertainty when the record does not answer the question.',
  );
  expect(built.request.maxOutputTokens).toBe(DEFAULT_MULTI_AGENT_BUDGET.maxOutputTokens);
  expect(built.request.temperature).toBe(0.2);
});

test('formats researcher data as values so JSON braces remain literal', async () => {
  const question = 'Europe PMC에서 {"query":"sleep {duration} adults"} 검색 결과를 요약해 주세요.';
  const allowedScope = { sourceKinds: ['external_medical'] } as const;
  const request = await buildResearchRequest(
    provider(),
    question,
    'missing_coverage',
    allowedScope,
    [],
    DEFAULT_MULTI_AGENT_BUDGET,
  );
  const userMessage = request.messages.find((message) => message.role === 'user');

  expect(request.messages.map((message) => message.role)).toEqual(['system', 'user']);
  expect(userMessage?.content).toContain(`Task: ${question}`);
  expect(userMessage?.content).toContain(`Allowed source scope: ${JSON.stringify(allowedScope)}`);
  expect(userMessage?.content).toContain(
    'Maximum results: ' + DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
  );
});
