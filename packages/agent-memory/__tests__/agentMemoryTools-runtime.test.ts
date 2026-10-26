import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { BaseStore } from '@langchain/langgraph/web';
import type { Operation, OperationResults } from '@langchain/langgraph/web';
import { createAgentMemory } from '../src/service';
import { createAgentMemoryStoreView, AGENT_MEMORY_NAMESPACE } from '../src/agentMemoryStoreView';
import { RememoriLangGraphStore } from '../src/langgraphStore/store';
import { createAgentMemoryTools } from '../src/tools';
import type { AgentMemoryToolPolicy } from '../src/types';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';

function createMemoryToolGraph(
  tools: ReturnType<typeof createAgentMemoryTools>,
  store?: BaseStore,
) {
  const builder = new StateGraph(MessagesAnnotation)
    .addNode('tools', new ToolNode([...tools]))
    .addEdge(START, 'tools')
    .addEdge('tools', END);
  return store ? builder.compile({ store }) : builder.compile();
}

async function callTool(
  graph: ReturnType<typeof createMemoryToolGraph>,
  name: string,
  args: Record<string, unknown>,
  config?: RunnableConfig,
): Promise<unknown> {
  const result = await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [{ id: name, name, args, type: 'tool_call' }],
        }),
      ],
    },
    config,
  );
  const message = result.messages.at(-1);
  if (!(message instanceof ToolMessage)) {
    throw new Error('The graph did not return a memory tool result.');
  }
  return JSON.parse(message.content as string) as unknown;
}

function authorizedPolicy(): AgentMemoryToolPolicy {
  return {
    authorizeWrite: async () => ({ provenance: preference.provenance }),
    authorizeDelete: async () => true,
  };
}

/** Injects a correction after the tool's ID lookup but before its Store deletion. */
class CorrectionInterleavingStore extends BaseStore {
  private interleaved = false;

  constructor(
    private readonly backingStore: BaseStore,
    private readonly correct: () => Promise<void>,
  ) {
    super();
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    if (!this.interleaved && operations.some(isAgentMemoryDelete)) {
      this.interleaved = true;
      await this.correct();
    }
    return this.backingStore.batch(operations);
  }

  async start(): Promise<void> {
    await this.backingStore.start?.();
  }

  async stop(): Promise<void> {
    await this.backingStore.stop?.();
  }
}

function isAgentMemoryDelete(operation: Operation): boolean {
  return (
    'value' in operation &&
    operation.value === null &&
    'namespace' in operation &&
    operation.namespace[0] === AGENT_MEMORY_NAMESPACE[0]
  );
}

describe('LangGraph memory tools', () => {
  it('fails closed without the compiled Store instead of falling back to the service', async () => {
    const memory = await createAgentMemory({
      embedder,
      storage: new PersistentMemoryStorage(),
    });
    const recall = jest.spyOn(memory, 'recall');
    const tools = createAgentMemoryTools(memory, authorizedPolicy());
    const graph = createMemoryToolGraph(tools);

    await expect(
      callTool(graph, 'recall_user_memory', { query: 'synthetic preference', limit: 2 }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'memory_store_unavailable' });
    expect(recall).not.toHaveBeenCalled();
    await memory.close();
  });

  it('uses one Store for authorized writes, recall, correction, and deletion', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const backingStore = new RememoriLangGraphStore({ embedder, storage });
    const store = createAgentMemoryStoreView(memory, backingStore);
    const draft = {
      memoryKey: preference.memoryKey,
      text: preference.text,
      kind: preference.kind,
    };
    const deniedPolicy: AgentMemoryToolPolicy = {
      authorizeWrite: async () => null,
      authorizeDelete: async () => false,
    };
    const deniedGraph = createMemoryToolGraph(createAgentMemoryTools(memory, deniedPolicy), store);

    await expect(callTool(deniedGraph, 'remember_user_memory', draft)).resolves.toEqual({
      stored: false,
      reason: 'memory_write_not_authorized',
    });
    expect(await storage.listRecords()).toEqual([]);

    const graph = createMemoryToolGraph(createAgentMemoryTools(memory, authorizedPolicy()), store);
    const firstThread = { configurable: { thread_id: 'thread-a' } };
    const secondThread = { configurable: { thread_id: 'thread-b' } };
    const write = (await callTool(graph, 'remember_user_memory', draft, firstThread)) as {
      stored: boolean;
      id: string;
    };
    expect(write.stored).toBe(true);
    await expect(memory.getByKey(preference.memoryKey)).resolves.toMatchObject({
      id: write.id,
      provenance: preference.provenance,
    });
    await expect(store.get(AGENT_MEMORY_NAMESPACE, preference.memoryKey)).resolves.toMatchObject({
      value: { id: write.id },
    });

    const recalled = (await callTool(
      graph,
      'recall_user_memory',
      {
        query: preference.text,
        limit: 2,
      },
      firstThread,
    )) as { readonly id: string; readonly memoryKey: string }[];
    expect(recalled).toMatchObject([{ id: write.id, memoryKey: preference.memoryKey }]);

    const otherThreadGraph = createMemoryToolGraph(
      createAgentMemoryTools(memory, authorizedPolicy()),
      store,
    );
    const crossThreadRecall = await callTool(
      otherThreadGraph,
      'recall_user_memory',
      { query: preference.text, limit: 2 },
      secondThread,
    );
    expect(crossThreadRecall).toMatchObject([{ id: write.id, memoryKey: preference.memoryKey }]);

    const corrected = (await callTool(graph, 'update_user_memory', {
      ...draft,
      text: 'Synthetic corrected preference',
    })) as { updated: boolean; id: string };
    expect(corrected.updated).toBe(true);
    expect(corrected.id).not.toBe(write.id);
    expect(await storage.listRecords()).toHaveLength(1);

    const deniedDeleteGraph = createMemoryToolGraph(
      createAgentMemoryTools(memory, deniedPolicy),
      store,
    );
    await expect(
      callTool(deniedDeleteGraph, 'forget_user_memory', { memoryId: corrected.id }),
    ).resolves.toEqual({ deleted: false, reason: 'memory_delete_not_authorized' });
    expect(await memory.getByKey(preference.memoryKey)).not.toBeNull();

    const forgotten = await callTool(graph, 'forget_user_memory', {
      memoryId: corrected.id,
    });
    expect(forgotten).toEqual({ deleted: true });
    expect(await memory.getByKey(preference.memoryKey)).toBeNull();
    await store.stop();
    await memory.close();
  });

  it('does not apply deletion of an old ID to a corrected memory at the same key', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const backingStore = createAgentMemoryStoreView(
      memory,
      new RememoriLangGraphStore({ embedder, storage }),
    );
    const originalId = await memory.remember(preference);
    const correctedText = 'Synthetic corrected preference';
    const store = new CorrectionInterleavingStore(backingStore, async () => {
      await memory.update({ ...preference, text: correctedText });
    });
    const graph = createMemoryToolGraph(createAgentMemoryTools(memory, authorizedPolicy()), store);

    await expect(callTool(graph, 'forget_user_memory', { memoryId: originalId })).resolves.toEqual({
      deleted: false,
    });
    await expect(memory.getByKey(preference.memoryKey)).resolves.toMatchObject({
      id: expect.not.stringMatching(originalId),
      text: correctedText,
    });
    await expect(storage.listRecords()).resolves.toHaveLength(1);
    await memory.close();
  });
});
