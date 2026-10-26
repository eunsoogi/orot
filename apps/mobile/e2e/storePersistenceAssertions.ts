import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import type { AgentMemoryStoreView } from '@orot/agent-memory';
import { correctedText } from '../src/memory/agentMemoryProbeFixtures';

/** Fail with the original native assertion boundary; never return synthetic success flags on error. */
export function requireProbe(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error('Native Store persistence: ' + message);
}

export async function assertIsolation(
  store: AgentMemoryStoreView,
  namespace: string[],
  key: string,
) {
  const rows = await store.search(namespace, {
    query: correctedText,
    filter: { text: correctedText },
  });
  requireProbe(
    rows.length === 1 &&
      rows[0]?.key === 'profile' &&
      JSON.stringify(rows[0].namespace) === JSON.stringify(namespace),
    'namespace/search isolation failed',
  );
  requireProbe(
    (await store.get(namespace, key)) === null,
    'ordinary memory leaked into Store namespace',
  );
  requireProbe(
    (await store.search([], { query: correctedText })).every(
      item => item.key !== key,
    ),
    'ordinary memory leaked into backing Store search',
  );
}

export async function assertAbsent(
  store: AgentMemoryStoreView,
  namespace: string[],
  foreign: string[],
  key: string,
) {
  requireProbe(
    (await store.get(namespace, 'profile')) === null,
    'deleted Store profile returned',
  );
  requireProbe(
    (await store.get(foreign, 'profile')) === null,
    'deleted foreign profile returned',
  );
  // Check every returned profile, including its final corrected text, while allowing the receipt row.
  requireProbe(
    (await store.search(namespace, { query: correctedText })).every(
      item => item.key !== 'profile',
    ),
    'deleted Store search returned',
  );
  requireProbe(
    (await store.get([...AGENT_MEMORY_NAMESPACE], key)) === null,
    'deleted ordinary memory returned through Store',
  );
  requireProbe(
    (
      await store.search([...AGENT_MEMORY_NAMESPACE], { query: correctedText })
    ).every(item => item.key !== key),
    'deleted ordinary memory returned through Store search',
  );
}
