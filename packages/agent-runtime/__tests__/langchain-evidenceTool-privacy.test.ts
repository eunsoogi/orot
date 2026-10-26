import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { CallbackManager } from '@langchain/core/callbacks/manager';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { fixture } from './langchain-evidenceTool-fixtures';

describe('private evidence tool callback boundary', () => {
  it.each(['denied', 'success', 'cancelled', 'invalid'] as const)(
    'keeps synthetic queries and evidence out of explicit and inherited callbacks: %s',
    async (state) => {
      const { tool, context, controller, domain } = fixture();
      const events: unknown[] = [];
      const handler = {
        name: 'local-privacy-observer',
        handleToolStart: (...args: unknown[]) => {
          events.push(args);
        },
        handleToolEnd: (...args: unknown[]) => {
          events.push(args);
        },
        handleToolError: (...args: unknown[]) => {
          events.push(args);
        },
      };
      const inherited = new CallbackManager();
      inherited.addHandler(handler, true);
      if (state === 'denied')
        jest.mocked(context.reserveSearch).mockReturnValue({ status: 'consent_required' });
      if (state === 'cancelled') controller.abort();
      const call = {
        type: 'tool_call' as const,
        id: 'private-call',
        name: domain.id,
        args: state === 'invalid' ? { query: 42 } : { query: 'SYNTHETIC_PRIVATE_QUERY' },
      };
      for (const callbacks of [[handler], inherited]) {
        if (state === 'invalid') {
          await expect(tool.invoke(call, { callbacks })).rejects.toMatchObject({
            message: 'Received tool input did not match expected schema',
            output: '',
          });
        } else {
          const result = await tool.invoke(call, { callbacks });
          expect(result).toBeInstanceOf(ToolMessage);
          expect(result.tool_call_id).toBe('private-call');
          expect(JSON.parse(result.content as string).status).toBe(
            state === 'denied'
              ? 'consent_required'
              : state === 'cancelled'
                ? 'cancelled'
                : 'result',
          );
        }
      }
      expect(events).toEqual([]);
    },
  );

  it.each(['denied', 'success'] as const)(
    'delivers ToolNode messages without callback payloads: %s',
    async (state) => {
      const { tool, context, domain, batch } = fixture();
      if (state === 'denied')
        jest.mocked(context.reserveSearch).mockReturnValue({ status: 'consent_required' });
      const callback = {
        name: 'local-tool-node-observer',
        handleToolStart: jest.fn(),
        handleToolEnd: jest.fn(),
        handleChainStart: jest.fn(),
      };
      const node = new ToolNode([tool]);
      const result = await node.invoke(
        {
          messages: [
            new AIMessage({
              content: '',
              tool_calls: [
                {
                  name: domain.id,
                  id: 'node-call',
                  type: 'tool_call',
                  args: { query: 'SYNTHETIC_PRIVATE_QUERY' },
                },
              ],
            }),
          ],
        },
        { callbacks: [callback] },
      );
      const message = result.messages[0] as ToolMessage;
      expect(message).toBeInstanceOf(ToolMessage);
      expect(message.tool_call_id).toBe('node-call');
      expect(JSON.parse(message.content as string)).toEqual(
        state === 'denied' ? { status: 'consent_required' } : { status: 'result', batch },
      );
      expect(callback.handleToolStart).not.toHaveBeenCalled();
      expect(callback.handleToolEnd).not.toHaveBeenCalled();
      expect(callback.handleChainStart).not.toHaveBeenCalled();
    },
  );

  it('never enters the callback-manager path that installs ambient tracing', async () => {
    const { tool } = fixture();
    const configure = jest.spyOn(CallbackManager, 'configure');
    try {
      await tool.invoke({ query: 'SYNTHETIC_PRIVATE_QUERY' });
      await tool.call({ query: 'SYNTHETIC_PRIVATE_QUERY' });
      expect(configure).not.toHaveBeenCalled();
    } finally {
      configure.mockRestore();
    }
  });
});
