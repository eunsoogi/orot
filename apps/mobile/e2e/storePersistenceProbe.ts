import {
  requireProbe,
  assertIsolation,
  assertAbsent,
} from './storePersistenceAssertions';
import { mutateStorePersistence } from './storePersistenceMutation';
import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import {
  createAgentMemoryProbeFixture,
  deterministicProvider,
  correctedText,
} from '../src/memory/agentMemoryProbeFixtures';
import {
  openLocalAgentMemory,
  openLocalAgentMemoryStore,
  closeLocalAgentMemory,
} from '../src/memory/localAgentMemory';
import {
  getCipherVersion,
  verifyWrongKeyRejected,
} from '../src/storage/secureDatabase';
import { probeStoreWorkflow } from './storeWorkflowProbe';

type Phase = 'fresh' | 'restart' | 'verify-deletion';

/** Keeps existing operation identifiers; only the three native persistence tests opt in. */
export async function runStorePersistenceOperation(
  operation: string,
  identifier?: string,
) {
  if (!identifier)
    throw new Error('Store persistence requires a scoped fixture');
  const phase =
    operation === 'memory-create'
      ? 'fresh'
      : operation === 'memory-restart'
        ? 'restart'
        : operation === 'memory-verify-deletion'
          ? 'verify-deletion'
          : null;
  if (!phase) throw new Error('Unsupported Store persistence phase');
  return {
    storeReceipt: await runStorePersistenceProbe(phase, identifier),
    synthetic: true,
  };
}

/** Extends the existing three-process driver over the app's single SQLCipher backend. */
export async function runStorePersistenceProbe(
  phase: Phase,
  identifier: string,
): Promise<Record<string, unknown> & { graphSearches: number }> {
  const fixture = createAgentMemoryProbeFixture(identifier);
  const namespace = ['native-store-persistence', identifier];
  const foreign = ['native-store-persistence', identifier + ':other'];
  const networkFetch = globalThis.fetch;
  const networkXhr = globalThis.XMLHttpRequest;
  let networkAttempts = 0;
  globalThis.fetch = (() => {
    networkAttempts += 1;
    throw new Error('Network disabled in Store probe');
  }) as typeof fetch;
  globalThis.XMLHttpRequest = class {
    constructor() {
      networkAttempts += 1;
      throw new Error('Network disabled in Store probe');
    }
  } as typeof XMLHttpRequest;
  try {
    if (phase === 'fresh') await runAgentMemoryProbe('fresh', identifier);
    const memory = await openLocalAgentMemory(deterministicProvider);
    const store = await openLocalAgentMemoryStore(deterministicProvider);
    requireProbe(await getCipherVersion(), 'SQLCipher is unavailable');
    requireProbe(await verifyWrongKeyRejected(), 'wrong key was accepted');
    const key = fixture.memoryInput.memoryKey;
    const legacy = await store.get([...AGENT_MEMORY_NAMESPACE], key);
    let searches = 0;
    let seed: Record<string, unknown>;
    if (phase === 'fresh') {
      requireProbe(
        legacy?.value.text === correctedText,
        'existing memory is invisible to Store',
      );
      await store.put(
        namespace,
        'profile',
        { text: correctedText, provenance: fixture.memoryInput.provenance },
        ['text'],
      );
      await store.put(
        foreign,
        'profile',
        { text: '다른 이름공간의 합성 기억' },
        ['text'],
      );
      const item = await store.get(namespace, 'profile');
      requireProbe(item, 'Store put/get lost the row');
      seed = {
        fixtureIdentifier: identifier,
        memoryKey: key,
        memoryId: legacy.value.id,
        memoryCreatedAt: legacy.createdAt.getTime(),
        createdAt: item.createdAt.getTime(),
        updatedAt: item.updatedAt.getTime(),
        provenance: item.value.provenance,
      };
      await store.put(namespace, 'receipt', seed, false);
    } else {
      const marker = await store.get(namespace, 'receipt');
      requireProbe(
        marker?.value.fixtureIdentifier === identifier,
        'seed receipt did not survive a new process',
      );
      seed = marker.value;
    }
    if (phase !== 'verify-deletion') {
      requireProbe(
        legacy &&
          legacy.value.id === seed.memoryId &&
          legacy.createdAt.getTime() === seed.memoryCreatedAt,
        'ordinary memory identity/time changed across process',
      );
      requireProbe(
        JSON.stringify(legacy.value.provenance) ===
          JSON.stringify(fixture.memoryInput.provenance),
        'ordinary provenance changed',
      );
      const restored = await store.get(namespace, 'profile');
      requireProbe(
        restored &&
          restored.createdAt.getTime() === seed.createdAt &&
          restored.updatedAt.getTime() === seed.updatedAt &&
          JSON.stringify(restored.value.provenance) ===
            JSON.stringify(seed.provenance),
        'Store timestamps/provenance did not persist',
      );
      await assertIsolation(store, namespace, key);
      requireProbe(
        (await memory.getByKey('profile')) === null,
        'Store row leaked into ordinary memory',
      );
      requireProbe(
        (await memory.recall(correctedText)).every(
          hit => hit.text !== '다른 이름공간의 합성 기억',
        ),
        'Store text leaked into ordinary recall',
      );
      const original = await probeStoreWorkflow({
        store,
        memory,
        fixture: identifier,
        text: correctedText,
        memoryId: String(seed.memoryId),
        present: true,
      });
      searches += original.searches;
      if (phase === 'restart')
        searches += await mutateStorePersistence({
          store,
          memory,
          identifier,
          namespace,
          foreign,
          seed,
          original,
        });
    } else {
      await assertAbsent(store, namespace, foreign, key);
      await closeLocalAgentMemory();
      await runAgentMemoryProbe('verify-deletion', identifier);
      const reopenedMemory = await openLocalAgentMemory(deterministicProvider);
      const reopenedStore = await openLocalAgentMemoryStore(
        deterministicProvider,
      );
      const absent = await probeStoreWorkflow({
        store: reopenedStore,
        memory: reopenedMemory,
        fixture: identifier,
        text: correctedText,
        memoryId: String(seed.memoryId),
        present: false,
      });
      searches += absent.searches;
      await reopenedStore.delete(namespace, 'receipt');
      requireProbe(
        (await reopenedStore.get(namespace, 'receipt')) === null,
        'receipt cleanup failed',
      );
    }
    requireProbe(networkAttempts === 0, 'network access was attempted');
    return {
      ...seed,
      phase,
      graphSearches: searches,
      sqlCipher: true,
      networkAttempts,
      syntheticProvider: true,
      storeVerified: true,
    };
  } finally {
    globalThis.fetch = networkFetch;
    globalThis.XMLHttpRequest = networkXhr;
    await closeLocalAgentMemory();
  }
}
