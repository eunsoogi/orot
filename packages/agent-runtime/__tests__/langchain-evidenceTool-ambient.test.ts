import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { CallbackManager } from '@langchain/core/callbacks/manager';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { fixture } from './langchain-evidenceTool-fixtures';

// This recorder never creates a remote tracer or changes environment/global tracing configuration.
class Recorder extends BaseCallbackHandler {
  name = 'synthetic-local-recorder';
  events: unknown[] = [];
  handleToolStart(...args: unknown[]) {
    this.events.push(args);
  }
  handleToolEnd(...args: unknown[]) {
    this.events.push(args);
  }
  handleChainStart(...args: unknown[]) {
    this.events.push(args);
  }
  handleChainEnd(...args: unknown[]) {
    this.events.push(args);
  }
}

function messages(name: string) {
  return {
    messages: [
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name,
            type: 'tool_call',
            id: 'ambient-call',
            args: { query: 'SYNTHETIC_PRIVATE_QUERY' },
          },
        ],
      }),
    ],
  };
}

describe('private evidence ambient callback isolation', () => {
  it.each(['denied', 'success'] as const)(
    'suppresses ambient hooks with a positive control: %s',
    async (state) => {
      const { tool, domain, context, batch } = fixture();
      const recorder = new Recorder();
      const key = `synthetic-evidence-trace-${state}`;
      registerConfigureHook({ contextVar: key, inheritable: true });
      AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
      await AsyncLocalStorageProviderSingleton.runWithConfig({}, async () => {
        setContextVariable(key, recorder);
        try {
          // Establish the real library's ambient hook would observe the same synthetic query.
          const standard = new DynamicStructuredTool({
            name: 'positive_control',
            description: 'Synthetic control',
            schema: domain.inputSchema,
            func: async () => 'SYNTHETIC_PRIVATE_RESULT',
          });
          await standard.invoke({ query: 'SYNTHETIC_PRIVATE_QUERY' });
          expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_QUERY');
          expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_RESULT');
          recorder.events = [];
          if (state === 'denied')
            jest.mocked(context.reserveSearch).mockReturnValue({ status: 'consent_required' });
          const direct = await tool.invoke({ query: 'SYNTHETIC_PRIVATE_QUERY' });
          expect(JSON.parse(direct).status).toBe(
            state === 'denied' ? 'consent_required' : 'result',
          );
          const result = await new ToolNode([tool]).invoke(messages(domain.id));
          const message = result.messages[0] as ToolMessage;
          expect(message.tool_call_id).toBe('ambient-call');
          expect(JSON.parse(message.content as string)).toEqual(
            state === 'denied' ? { status: 'consent_required' } : { status: 'result', batch },
          );
          expect(recorder.events).toEqual([]);
        } finally {
          setContextVariable(key, undefined);
        }
      });
    },
  );

  it('does not emit private ToolNode payloads to an inherited outer run', async () => {
    const { tool, domain, batch } = fixture();
    const recorder = new Recorder();
    const manager = new CallbackManager();
    manager.addHandler(recorder, true);
    const outer = await manager.handleChainStart(
      { lc: 1, type: 'not_implemented', id: ['synthetic'] },
      {},
    );
    const result = await new ToolNode([tool]).invoke(messages(domain.id), {
      callbacks: outer.getChild(),
    });
    const message = result.messages[0] as ToolMessage;
    expect(JSON.parse(message.content as string)).toEqual({ status: 'result', batch });
    expect(message.tool_call_id).toBe('ambient-call');
    expect(JSON.stringify(recorder.events)).not.toContain('SYNTHETIC_PRIVATE_QUERY');
    expect(JSON.stringify(recorder.events)).not.toContain('Local observation');
    await outer.handleChainEnd({ status: 'complete' });
  });
});
