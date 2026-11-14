import type { EvidenceReference } from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { captureConversationSources } from '../captureConversationSources';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { localData, memoryRecord } from '../featureServiceFixtures';
import { fingerprint } from '../evidenceUtils';

/** Synthetic memory records exercise actual retained-source capture and local reader restoration. */
async function fixture() {
  const memory = memoryRecord(1);
  const second = memoryRecord(2);
  const fixtureData = localData([memory, second]);
  const registry = new LocalEvidenceReferenceRegistry();
  const aliases = [memory, second].map(record => {
    const revision = fingerprint({ text: record.text, meta: record.meta });
    const reference: EvidenceReference = {
      sourceKind: 'reviewed_memory',
      sourceId: record.id,
      evidenceId: record.id,
      sourceRevision: revision,
      evidenceRevision: revision,
      locator: { kind: 'reviewed_memory', id: record.id },
      effectiveTime: '2026-11-14T00:00:00.000Z',
      reviewState: 'reviewed',
    };
    return registry.add({
      reference,
      content: record.text,
      validate: async () => true,
      readSource: async () => ({
        status: 'available',
        document: { sourceKind: 'reviewed_memory', record },
      }),
    });
  });
  const controller = new AbortController();
  const captured = await captureConversationSources(
    aliases,
    registry,
    controller.signal,
  );
  const load = jest.spyOn(fixtureData.data, 'loadMemoryRecords');
  return {
    ...fixtureData,
    memory,
    aliases,
    registry,
    controller,
    load,
    input: {
      snapshot: registry.snapshot(),
      sources: captured.sources,
      data: fixtureData.data,
      signal: controller.signal,
    },
  };
}

test('rebinds exact saved aliases through real local readers, despite reversed descriptor order', async () => {
  const f = await fixture();
  const restored = await restoreColdConversationRegistry({
    ...f.input,
    sources: [...f.input.sources].reverse(),
  });
  expect(f.load).toHaveBeenCalled();
  for (const alias of f.aliases) {
    expect(restored.resolve(alias)).toEqual(f.registry.resolve(alias));
    await expect(
      restored.readSource(alias, f.input.signal),
    ).resolves.toMatchObject({ status: 'available' });
  }
  expect(restored.localSourceIds([f.aliases[0].sourceId])).toEqual([
    f.memory.id,
  ]);
  expect(restored.redactText(f.memory.id)).not.toContain(f.memory.id);
  expect(f.data.rag.search).not.toHaveBeenCalled();
  expect(f.data.rag.index).not.toHaveBeenCalled();
  f.replaceMemoryRecords([]);
  await expect(
    restored.revalidateEvidence(f.aliases, f.input.signal),
  ).resolves.toBe(false);
});

test.each(['missing', 'changed'] as const)(
  'rejects %s sources rather than using cached aliases',
  async change => {
    const f = await fixture();
    f.replaceMemoryRecords(
      change === 'missing'
        ? []
        : [{ ...f.memory, text: 'changed synthetic text' }],
    );
    await expect(restoreColdConversationRegistry(f.input)).rejects.toThrow();
    expect(f.data.rag.search).not.toHaveBeenCalled();
  },
);

test.each([
  'missing',
  'duplicate',
  'mismatch',
  'photo',
  'external',
  'unknown',
] as const)(
  'rejects %s descriptors before accessing local data',
  async change => {
    const f = await fixture();
    const sources = JSON.parse(JSON.stringify(f.input.sources));
    const snapshot = JSON.parse(JSON.stringify(f.input.snapshot));
    if (change === 'missing') sources.pop();
    if (change === 'duplicate') sources.push(sources[0]);
    if (change === 'mismatch') sources[0].reference.sourceRevision = 'changed';
    if (change === 'photo') sources[0].kind = 'conversation_photo';
    if (change === 'external') {
      sources[0].reference.sourceKind = 'external_medical';
      snapshot.entries[0].original.sourceKind = 'external_medical';
    }
    if (change === 'unknown') sources[0].kind = 'unsupported';
    await expect(
      restoreColdConversationRegistry({ ...f.input, sources, snapshot }),
    ).rejects.toThrow();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.data.rag.search).not.toHaveBeenCalled();
  },
);

test('abort before restore performs no reads and abort during a read stops further source restoration', async () => {
  const f = await fixture();
  f.controller.abort();
  await expect(restoreColdConversationRegistry(f.input)).rejects.toThrow(
    'cancelled',
  );
  expect(f.load).not.toHaveBeenCalled();
  const other = await fixture();
  other.load.mockImplementationOnce(async () => {
    other.controller.abort();
    return [other.memory];
  });
  await expect(restoreColdConversationRegistry(other.input)).rejects.toThrow(
    'cancelled',
  );
  expect(other.load).toHaveBeenCalledTimes(1);
});

test('source change between initial restoration and final validation fails closed', async () => {
  const f = await fixture();
  const records = await f.data.loadMemoryRecords();
  f.load.mockReset();
  f.load
    .mockResolvedValueOnce(records)
    .mockResolvedValueOnce(records)
    .mockResolvedValue([]);
  await expect(restoreColdConversationRegistry(f.input)).rejects.toThrow(
    'validation',
  );
});

test('an empty local registry needs no source lookup', async () => {
  const f = await fixture();
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreColdConversationRegistry({
    ...f.input,
    snapshot: registry.snapshot(),
    sources: [],
  });
  expect(restored.snapshot()).toEqual(registry.snapshot());
  expect(f.load).not.toHaveBeenCalled();
});
