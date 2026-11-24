import type { LanguageModelProvider } from '@orot/model-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import type { TaskResponderContract, TaskResponderInput } from '../src/multiAgent/contracts';
import { buildTaskRequest } from '../src/multiAgent/requests';

test.each([true, false])(
  'stable research policy precedes changing capacity across requests (native tools: %s)',
  async (toolCalling) => {
    const generate = jest.fn();
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'chatgpt-plan:synthetic',
      displayName: 'Synthetic model',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling,
      },
      generate,
    };
    const body = [
      { role: 'user' as const, content: 'An older synthetic turn' },
      { role: 'user' as const, content: 'The exact synthetic question {untouched}' },
    ];
    const contract: TaskResponderContract<string> = {
      taskType: 'test',
      taskVersion: '1',
      systemPrompt: 'Use current evidence.',
      resultSchema: { type: 'string' },
      createMessages: () => body,
      validateResult: () => ({ status: 'valid', value: 'synthetic' }),
    };
    const research = {
      canRequestEvidence: true,
      allowedScope: { sourceKinds: ['personal_record'] as const },
      candidateTools: [
        {
          id: 'local-synthetic',
          sourceKind: 'personal_record' as const,
          execution: 'local_read_only' as const,
        },
      ],
      remainingModelCalls: 3,
      remainingToolCalls: 2,
      remainingResearchCycles: 1,
    } satisfies NonNullable<TaskResponderInput['research']>;
    const call = async (remainingModelCalls: number) => {
      const capacity = { ...research, remainingModelCalls };
      const result = await buildTaskRequest(
        provider,
        contract,
        {
          request: body.at(-1)!.content,
          evidence: { items: [], coverage: [], conflicts: [] },
          research: capacity,
        },
        DEFAULT_MULTI_AGENT_BUDGET,
      );
      if (result.status !== 'ready') throw new Error('Expected prepared request');
      const [system, ...messages] = result.request.messages;
      if (system?.role !== 'system' || typeof system.content !== 'string')
        throw new Error('Expected text policy');
      const suffix = '\nResearch planning capacity for this response: ' + JSON.stringify(capacity);
      expect(system.content.endsWith(suffix)).toBe(true);
      expect(messages.slice(0, body.length)).toEqual(body);
      return { prefix: system.content.slice(0, -suffix.length), messages, system };
    };
    const first = await call(3);
    const next = await call(2);
    expect(first.system.content).not.toBe(next.system.content);
    expect(first.prefix).toBe(next.prefix);
    expect(first.prefix).toContain('Planning capacity is not permission');
    expect(first.prefix).toContain(
      'When canRequestEvidence is false, do not request another search.',
    );
    expect(first.messages).toEqual(next.messages);
    expect(generate).not.toHaveBeenCalled();
  },
);
