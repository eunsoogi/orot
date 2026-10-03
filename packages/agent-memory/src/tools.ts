import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AgentMemoryService } from './service';
import type { AgentMemoryDraft, AgentMemoryToolPolicy } from './types';

const draftSchema = z.object({
  memoryKey: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(4000),
  kind: z.enum(['preference', 'reviewed_interaction', 'task_context']),
});

/** Tools for a LangGraph recommendation workflow; writes require caller authorization. */
export function createAgentMemoryTools(memory: AgentMemoryService, policy: AgentMemoryToolPolicy) {
  const remember = tool(async (draft: AgentMemoryDraft) => {
    const authorization = await policy.authorizeWrite(draft);
    if (!authorization) return JSON.stringify({ stored: false, reason: 'memory_write_not_authorized' });
    const id = await memory.remember({ ...draft, provenance: authorization.provenance });
    return JSON.stringify({ stored: true, id });
  }, {
    name: 'remember_user_memory',
    description: 'Store a user-confirmed preference, reviewed interaction, or task context after the caller authorizes the write.',
    schema: draftSchema,
  });

  const update = tool(async (draft: AgentMemoryDraft) => {
    const authorization = await policy.authorizeWrite(draft);
    if (!authorization) return JSON.stringify({ updated: false, reason: 'memory_write_not_authorized' });
    const id = await memory.update({ ...draft, provenance: authorization.provenance });
    return JSON.stringify({ updated: true, id });
  }, {
    name: 'update_user_memory',
    description: 'Correct a caller-authorized memory. A stable memory key replaces its previous value atomically.',
    schema: draftSchema,
  });

  const recall = tool(async ({ query, limit }) => {
    const hits = await memory.recall(query, { limit });
    return JSON.stringify(hits);
  }, {
    name: 'recall_user_memory',
    description: 'Search only persistent agent memories. Use RAG tools separately for source records and evidence.',
    schema: z.object({ query: z.string().trim().min(1).max(1000), limit: z.number().int().min(1).max(5).default(3) }),
  });

  const forget = tool(async ({ memoryId }) => {
    if (!(await policy.authorizeDelete(memoryId))) {
      return JSON.stringify({ deleted: false, reason: 'memory_delete_not_authorized' });
    }
    return JSON.stringify({ deleted: await memory.forget(memoryId) });
  }, {
    name: 'forget_user_memory',
    description: 'Delete one memory only after the caller authorizes the deletion.',
    schema: z.object({ memoryId: z.string().trim().min(1).max(160) }),
  });

  return [remember, recall, update, forget] as const;
}
