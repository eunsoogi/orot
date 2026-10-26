import { tool } from '@langchain/core/tools';
import type { ToolRuntime } from '@langchain/core/tools';
import type { BaseStore, Item } from '@langchain/langgraph/web';
import { z } from 'zod';
import type { AgentMemoryService } from './service';
import {
  AGENT_MEMORY_DELETE_BY_ID_NAMESPACE,
  AGENT_MEMORY_NAMESPACE,
} from './agentMemoryStoreView';
import type {
  AgentMemoryDraft,
  AgentMemoryHit,
  AgentMemoryProvenance,
  AgentMemoryToolPolicy,
} from './types';

const draftSchema = z.object({
  memoryKey: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(4000),
  kind: z.enum(['preference', 'reviewed_interaction', 'task_context']),
});

/** Tools use only the Store injected by LangGraph; the service parameter remains API-compatible. */
export function createAgentMemoryTools(_memory: AgentMemoryService, policy: AgentMemoryToolPolicy) {
  const remember = tool(
    async (draft: AgentMemoryDraft, runtime: ToolRuntime) => {
      const store = graphStoreFromRuntime(runtime);
      if (!store) return JSON.stringify({ stored: false, reason: 'memory_store_unavailable' });
      const authorization = await policy.authorizeWrite(draft);
      if (!authorization)
        return JSON.stringify({ stored: false, reason: 'memory_write_not_authorized' });
      const id = await writeThroughStore(store, draft, authorization.provenance);
      return JSON.stringify({ stored: true, id });
    },
    {
      name: 'remember_user_memory',
      description:
        'Store a user-confirmed preference, reviewed interaction, or task context after the caller authorizes the write.',
      schema: draftSchema,
    },
  );

  const update = tool(
    async (draft: AgentMemoryDraft, runtime: ToolRuntime) => {
      const store = graphStoreFromRuntime(runtime);
      if (!store) return JSON.stringify({ updated: false, reason: 'memory_store_unavailable' });
      const authorization = await policy.authorizeWrite(draft);
      if (!authorization)
        return JSON.stringify({ updated: false, reason: 'memory_write_not_authorized' });
      const id = await writeThroughStore(store, draft, authorization.provenance);
      return JSON.stringify({ updated: true, id });
    },
    {
      name: 'update_user_memory',
      description:
        'Correct a caller-authorized memory. A stable memory key replaces its previous value atomically.',
      schema: draftSchema,
    },
  );

  const recall = tool(
    async ({ query, limit }, runtime: ToolRuntime) => {
      const store = graphStoreFromRuntime(runtime);
      if (!store)
        return JSON.stringify({ status: 'unavailable', reason: 'memory_store_unavailable' });
      const hits = await store.search([...AGENT_MEMORY_NAMESPACE], { query, limit });
      return JSON.stringify(
        hits.flatMap((hit) => {
          const value = memoryHitFromStoreItem(hit);
          return value ? [value] : [];
        }),
      );
    },
    {
      name: 'recall_user_memory',
      description:
        'Search only persistent agent memories. Use RAG tools separately for source records and evidence.',
      schema: z.object({
        query: z.string().trim().min(1).max(1000),
        limit: z.number().int().min(1).max(5).default(3),
      }),
    },
  );

  const forget = tool(
    async ({ memoryId }, runtime: ToolRuntime) => {
      const store = graphStoreFromRuntime(runtime);
      if (!store) return JSON.stringify({ deleted: false, reason: 'memory_store_unavailable' });
      if (!(await policy.authorizeDelete(memoryId))) {
        return JSON.stringify({ deleted: false, reason: 'memory_delete_not_authorized' });
      }
      const [item] = await store.search([...AGENT_MEMORY_NAMESPACE], {
        filter: { id: memoryId },
        limit: 1,
      });
      if (!item) return JSON.stringify({ deleted: false });
      await store.delete([...AGENT_MEMORY_DELETE_BY_ID_NAMESPACE], memoryId);
      // A replacement at the same stable key remains protected by its new ID.
      const current = await store.get([...AGENT_MEMORY_NAMESPACE], item.key);
      return JSON.stringify({ deleted: current === null });
    },
    {
      name: 'forget_user_memory',
      description: 'Delete one memory only after the caller authorizes the deletion.',
      schema: z.object({ memoryId: z.string().trim().min(1).max(160) }),
    },
  );

  return [remember, recall, update, forget] as const;
}

async function writeThroughStore(
  store: BaseStore,
  draft: AgentMemoryDraft,
  provenance: AgentMemoryProvenance,
): Promise<string> {
  await store.put([...AGENT_MEMORY_NAMESPACE], draft.memoryKey, {
    ...draft,
    memoryKey: draft.memoryKey,
    provenance,
  });
  const item = await store.get([...AGENT_MEMORY_NAMESPACE], draft.memoryKey);
  if (typeof item?.value.id !== 'string') {
    throw new Error('The authorized memory write could not be read back from Store.');
  }
  return item.value.id;
}

/** LangGraph injects its graph Store; ToolRuntime's core type only exposes its KV subset. */
function graphStoreFromRuntime(runtime: ToolRuntime): BaseStore | undefined {
  return runtime.store as unknown as BaseStore | undefined;
}

function memoryHitFromStoreItem(item: Item): AgentMemoryHit | null {
  const value = item.value;
  const provenance = value.provenance;
  const score = (item as Item & { readonly score?: number }).score ?? value.score;
  if (
    typeof value.memoryKey !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    (value.kind !== 'preference' &&
      value.kind !== 'reviewed_interaction' &&
      value.kind !== 'task_context') ||
    !isAgentMemoryProvenance(provenance) ||
    typeof value.createdAt !== 'number' ||
    typeof score !== 'number'
  ) {
    return null;
  }
  return {
    memoryKey: value.memoryKey,
    id: value.id,
    text: value.text,
    score,
    kind: value.kind,
    provenance,
    createdAt: value.createdAt,
  };
}

function isAgentMemoryProvenance(value: unknown): value is AgentMemoryHit['provenance'] {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as AgentMemoryHit['provenance'];
  return (
    Array.isArray(provenance.sourceIds) &&
    provenance.sourceIds.every((id) => typeof id === 'string') &&
    (provenance.reviewState === 'user_confirmed' || provenance.reviewState === 'human_reviewed')
  );
}
