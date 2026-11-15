import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { coldResearchRegistryFixture as fixture } from '../testSupport/coldResearchRegistryFixture';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';

/** These exercise the two cold restoration regressions through actual SQLite research snapshots. */
test('restores parent/child once and repeatedly opens dependency aliases in the returned registry', async () => {
  const f = await fixture();
  try {
    const restored = await restoreColdConversationRegistry(f.input);
    expect(restored.snapshot()).toEqual(f.input.snapshot);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const read = await restored.readSource(f.childAlias, f.input.signal);
      if (
        read.status !== 'available' ||
        read.document.sourceKind !== 'generated_artifact' ||
        !('research' in read.document)
      )
        throw new Error('Expected research detail');
      const dependency = read.document.sources.find(
        value => value.sourceKind === 'generated_artifact',
      )!;
      expect(restored.resolve(dependency)).toEqual(f.parent.reference);
      expect(
        (await restored.readSource(dependency, f.input.signal)).status,
      ).toBe('available');
      expect(
        await restored.revalidateEvidence([f.childAlias], f.input.signal),
      ).toBe(true);
      expect(restored.snapshot()).toEqual(f.input.snapshot);
    }
    const concurrent = await Promise.all(
      [1, 2].map(() => restored.readSource(f.childAlias, f.input.signal)),
    );
    expect(concurrent.map(value => value.status)).toEqual([
      'available',
      'available',
    ]);
    expect(restored.snapshot()).toEqual(f.input.snapshot);
    expect(f.data.rag.search).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});

test.each(['delete', 'revision'] as const)(
  'rejects a %s after restoration without using cached research text',
  async action => {
    const f = await fixture();
    try {
      const restored = await restoreColdConversationRegistry(f.input);
      if (action === 'delete')
        await f.db.database.execute(
          'DELETE FROM research_artifacts WHERE id = ?',
          [1],
        );
      else {
        const row = (
          await f.db.database.execute(
            'SELECT snapshot_json FROM research_artifacts WHERE id = ?',
            [2],
          )
        ).rows[0]!;
        const stored = JSON.parse(String(row.snapshot_json));
        await f.db.database.execute(
          'UPDATE research_artifacts SET snapshot_json = ? WHERE id = ?',
          [
            JSON.stringify({
              ...stored,
              generatedText: 'Changed synthetic explanation',
            }),
            2,
          ],
        );
      }
      expect(
        (await restored.readSource(f.childAlias, f.input.signal)).status,
      ).not.toBe('available');
      expect(
        await restored.revalidateEvidence([f.childAlias], f.input.signal),
      ).toBe(false);
    } finally {
      f.db.close();
    }
  },
);

test('aborting a local read prevents an otherwise unchanged research snapshot from escaping', async () => {
  const f = await fixture();
  try {
    const restored = await restoreColdConversationRegistry(f.input);
    const read = f.discovery.read.bind(f.discovery);
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const result = await read(id, signal);
      f.controller.abort();
      return result;
    });
    expect(
      (await restored.readSource(f.childAlias, f.input.signal)).status,
    ).not.toBe('available');
    expect(
      await restored.revalidateEvidence([f.childAlias], f.input.signal),
    ).toBe(false);
  } finally {
    f.db.close();
  }
});

test('missing dependency cannot be allocated or searched into the cold registry', async () => {
  const f = await fixture();
  try {
    const childOnly = new LocalEvidenceReferenceRegistry();
    childOnly.add({
      reference: f.child.reference,
      content: '',
      validate: async () => true,
      readSource: async () => ({ status: 'unavailable' }),
    });
    await expect(
      restoreColdConversationRegistry({
        ...f.input,
        snapshot: childOnly.snapshot(),
        sources: [f.child],
      }),
    ).rejects.toThrow();
    expect(f.data.rag.search).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});

test('multiple saved aliases for the same dependency are ambiguous, never first-match selected', async () => {
  const f = await fixture();
  try {
    f.add(f.parent);
    await expect(
      restoreColdConversationRegistry({
        ...f.input,
        snapshot: f.original.snapshot(),
      }),
    ).rejects.toThrow();
  } finally {
    f.db.close();
  }
});

test('mismatched protected descriptor identity fails before reader reuse', async () => {
  const f = await fixture();
  try {
    await expect(
      restoreColdConversationRegistry({
        ...f.input,
        sources: [f.parent, { ...f.child, revision: 'not-the-saved-revision' }],
      }),
    ).rejects.toThrow();
  } finally {
    f.db.close();
  }
});

test('an adversarial discovery cycle is rejected with a per-read path, not followed recursively', async () => {
  const f = await fixture();
  try {
    // SQLite remains real; this injected discovery inconsistency isolates cycle detection from DB revision guards.
    const read = f.discovery.read.bind(f.discovery);
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const value = await read(id, signal);
      return value && id === f.parent.id
        ? { ...value, content: { ...value.content, inputSources: [f.child] } }
        : value;
    });
    await expect(restoreColdConversationRegistry(f.input)).rejects.toThrow();
  } finally {
    f.db.close();
  }
});
