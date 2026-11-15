import { coldResearchRegistryFixture as fixture } from '../testSupport/coldResearchRegistryFixture';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreResearchSource } from '../restoreResearchSource';
import { captureConversationSources } from '../captureConversationSources';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { reuseResearchInputAliases } from '../researchInputAliasReuse';

/** Actual live reader → capture → cold owner with real SQLite, no provider or user data. */
test('live research reads reuse verified dependency aliases and produce a cold-restorable snapshot', async () => {
  const f = await fixture();
  try {
    const live = new LocalEvidenceReferenceRegistry();
    const source = await restoreResearchSource(
      f.child,
      live,
      f.data,
      f.input.signal,
    );
    if (!source) throw new Error('Missing live source');
    expect(live.snapshot().entries).toHaveLength(2);
    for (let i = 0; i < 3; i++) {
      const results = await Promise.all(
        [1, 2].map(() => live.readSource(source.reference, f.input.signal)),
      );
      expect(results.map(value => value.status)).toEqual([
        'available',
        'available',
      ]);
      expect(live.snapshot().entries).toHaveLength(2);
    }
    const snapshot = live.snapshot();
    const captured = await captureConversationSources(
      snapshot.entries.map(row => row.alias),
      live,
      f.input.signal,
    );
    expect(live.snapshot()).toEqual(snapshot);
    const cold = await restoreColdConversationRegistry({
      snapshot,
      sources: captured.sources,
      data: f.data,
      signal: f.input.signal,
    });
    expect(
      (await cold.readSource(source.reference, f.input.signal)).status,
    ).toBe('available');
    expect(cold.snapshot()).toEqual(snapshot);
    expect(f.data.rag.search).not.toHaveBeenCalled();
    await f.db.database.execute(
      'DELETE FROM research_artifacts WHERE id = ?',
      [1],
    );
    expect(
      (await live.readSource(source.reference, f.input.signal)).status,
    ).not.toBe('available');
  } finally {
    f.db.close();
  }
});

test('concurrent restoration of one complete descriptor allocates one alias', async () => {
  const f = await fixture();
  try {
    const registry = new LocalEvidenceReferenceRegistry();
    const results = await Promise.all(
      [1, 2].map(() =>
        reuseResearchInputAliases([f.parent], registry, f.data, f.input.signal),
      ),
    );
    expect([...results[0].values()]).toEqual([...results[1].values()]);
    expect(registry.snapshot().entries).toHaveLength(1);
  } finally {
    f.db.close();
  }
});

test('reuse preserves an existing reader veto instead of replacing it with a broader reader', async () => {
  const f = await fixture();
  try {
    const registry = new LocalEvidenceReferenceRegistry();
    const detail = await f.discovery.read(f.parent.id);
    if (!detail) throw new Error('Missing research fixture');
    registry.add({
      reference: f.parent.reference,
      content: '',
      validate: async () => false,
      readSource: async () => ({
        status: 'available',
        document: {
          sourceKind: 'generated_artifact',
          metadata: detail.metadata,
          research: { ...detail.content, inputSources: [] },
          sources: detail.sources,
          sourceStatus: 'unknown',
        },
      }),
    });
    await expect(
      reuseResearchInputAliases([f.parent], registry, f.data, f.input.signal),
    ).rejects.toThrow();
    expect(registry.snapshot().entries).toHaveLength(1);
  } finally {
    f.db.close();
  }
});

test('a cyclic discovery graph fails before waiting on its own pending alias restoration', async () => {
  const f = await fixture();
  try {
    const registry = new LocalEvidenceReferenceRegistry();
    const read = f.discovery.read.bind(f.discovery);
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const result = await read(id, signal);
      return result && id === f.parent.id
        ? { ...result, content: { ...result.content, inputSources: [f.child] } }
        : result;
    });
    await expect(
      restoreResearchSource(f.child, registry, f.data, f.input.signal),
    ).rejects.toThrow('Cyclic');
    expect(registry.snapshot().entries).toHaveLength(0);
  } finally {
    f.db.close();
  }
});

test.each(['duplicate', 'abort'])(
  'a %s during reader capture cannot pass the final fence',
  async mode => {
    const f = await fixture();
    try {
      const registry = new LocalEvidenceReferenceRegistry();
      await restoreResearchSource(f.parent, registry, f.data, f.input.signal);
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const read = f.discovery.read.bind(f.discovery);
      jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
        entered();
        await gate;
        return read(id, signal);
      });
      const restoring = reuseResearchInputAliases(
        [f.parent],
        registry,
        f.data,
        f.input.signal,
      );
      await started;
      if (mode === 'duplicate')
        registry.add({
          reference: f.parent.reference,
          content: '',
          validate: async () => false,
          readSource: async () => ({ status: 'unavailable' }),
        });
      else f.controller.abort();
      release();
      await expect(restoring).rejects.toThrow();
      expect(registry.snapshot().entries).toHaveLength(
        mode === 'duplicate' ? 2 : 1,
      );
    } finally {
      f.db.close();
    }
  },
);

test('equal original identity does not authorize a different complete descriptor', async () => {
  const f = await fixture();
  try {
    const registry = new LocalEvidenceReferenceRegistry();
    await restoreResearchSource(f.parent, registry, f.data, f.input.signal);
    await expect(
      reuseResearchInputAliases(
        [{ ...f.parent, revision: 'different' }],
        registry,
        f.data,
        f.input.signal,
      ),
    ).rejects.toThrow('descriptor');
    expect(registry.snapshot().entries).toHaveLength(1);
  } finally {
    f.db.close();
  }
});
