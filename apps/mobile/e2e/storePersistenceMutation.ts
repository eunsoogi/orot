import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import type {
  AgentMemoryService,
  AgentMemoryStoreView,
} from '@orot/agent-memory';
import {
  createAgentMemoryProbeFixture,
  deterministicProvider,
  correctedText,
} from '../src/memory/agentMemoryProbeFixtures';
import {
  closeLocalAgentMemory,
  openLocalAgentMemoryStore,
} from '../src/memory/localAgentMemory';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import { probeStoreWorkflow } from './storeWorkflowProbe';
import { requireProbe, assertAbsent } from './storePersistenceAssertions';

const updatedText = '사용자는 다음 외래 알림을 오전 11시에 받고 싶어 한다.';

/** Corrects through Store, invalidates app citations, then performs the original authorized source deletion. */
export async function mutateStorePersistence(input: {
  store: AgentMemoryStoreView;
  memory: AgentMemoryService;
  identifier: string;
  namespace: string[];
  foreign: string[];
  seed: Record<string, unknown>;
  original: Awaited<ReturnType<typeof probeStoreWorkflow>>;
}) {
  const { store, memory, identifier, namespace, foreign, seed, original } =
    input;
  const fixture = createAgentMemoryProbeFixture(identifier);
  const key = fixture.memoryInput.memoryKey;
  let unreviewedRejected = false;
  try {
    await store.put([...AGENT_MEMORY_NAMESPACE], key, {
      ...fixture.memoryInput,
      text: updatedText,
      provenance: {
        ...fixture.memoryInput.provenance,
        reviewState: 'unreviewed',
      },
    });
  } catch {
    unreviewedRejected = true;
  }
  requireProbe(
    unreviewedRejected && (await memory.getByKey(key))?.text === correctedText,
    'Store bypassed user review or changed memory after rejection',
  );
  // Store correction and ordinary reads must address the same Rememori row authority.
  await store.put([...AGENT_MEMORY_NAMESPACE], key, {
    ...fixture.memoryInput,
    text: updatedText,
  });
  requireProbe(
    (await memory.getByKey(key))?.text === updatedText,
    'Store correction missed ordinary memory',
  );
  await original.assertStale();
  const correction = await memory.getByKey(key);
  requireProbe(
    correction,
    'Store correction lost its ordinary memory identity',
  );
  const correctedGraph = await probeStoreWorkflow({
    store,
    memory,
    fixture: identifier,
    text: updatedText,
    memoryId: correction.id,
    present: true,
  });
  await store.put(
    namespace,
    'profile',
    { text: updatedText, provenance: fixture.memoryInput.provenance },
    ['text'],
  );
  const updated = await store.get(namespace, 'profile');
  requireProbe(
    updated &&
      updated.createdAt.getTime() === seed.createdAt &&
      updated.updatedAt.getTime() >= Number(seed.updatedAt) &&
      updated.value.text === updatedText,
    'Store update lost timestamp invariants',
  );
  requireProbe(
    (
      await store.search(namespace, {
        query: updatedText,
        filter: { text: updatedText },
      })
    )[0]?.key === 'profile',
    'updated Store search failed',
  );
  // Restore the original driver's expected correction before its source-deletion checks.
  await store.put([...AGENT_MEMORY_NAMESPACE], key, {
    ...fixture.memoryInput,
    text: correctedText,
  });
  await correctedGraph.assertStale();
  const current = await store.get([...AGENT_MEMORY_NAMESPACE], key);
  requireProbe(current, 'corrected memory disappeared before deletion');
  const beforeDelete = await probeStoreWorkflow({
    store,
    memory,
    fixture: identifier,
    text: correctedText,
    memoryId: String(current.value.id),
    present: true,
  });
  const searches = beforeDelete.searches + correctedGraph.searches;
  await closeLocalAgentMemory();
  await runAgentMemoryProbe('restart', identifier);
  await beforeDelete.assertStale();
  const reopened = await openLocalAgentMemoryStore(deterministicProvider);
  await reopened.delete(namespace, 'profile');
  await reopened.delete(foreign, 'profile');
  await assertAbsent(reopened, namespace, foreign, key);
  let rejected = false;
  try {
    await reopened.put([...AGENT_MEMORY_NAMESPACE], key, {
      ...fixture.memoryInput,
      text: correctedText,
    });
  } catch (error) {
    rejected =
      error instanceof Error && error.message.includes('already removed');
  }
  requireProbe(rejected, 'Store accepted a stale source after deletion');
  return searches;
}
