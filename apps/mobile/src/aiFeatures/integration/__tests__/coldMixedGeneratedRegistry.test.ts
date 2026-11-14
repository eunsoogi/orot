import { coldMixedGeneratedFixture as fixture } from '../testSupport/coldMixedGeneratedFixture';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { captureConversationSources } from '../captureConversationSources';
test('mixed conversation and research reads retain exact owner aliases through repeated cold capture', async () => {
  const f = await fixture();
  try {
    const restored = await restoreColdConversationRegistry(f.input);
    for (let index = 0; index < 3; index += 1) {
      const read = await restored.readSource(f.alias, f.input.signal);
      if (
        read.status !== 'available' ||
        read.document.sourceKind !== 'generated_artifact' ||
        !('conversation' in read.document)
      )
        throw new Error('Missing conversation');
      expect(read.document.conversation.answer).toBe('Synthetic saved answer');
      expect(read.document.sources).toEqual([referenceOnly(f.childAlias)]);
      expect(
        (await restored.readSource(read.document.sources[0]!, f.input.signal))
          .status,
      ).toBe('available');
      expect(await restored.revalidateEvidence([f.alias], f.input.signal)).toBe(
        true,
      );
      expect(restored.snapshot()).toEqual(f.input.snapshot);
    }
    expect(
      (await captureConversationSources([f.alias], restored, f.input.signal))
        .sources,
    ).toEqual([f.conversation]);
    const values = await Promise.all(
      [1, 2].map(() => restored.readSource(f.alias, f.input.signal)),
    );
    expect(values.map(value => value.status)).toEqual([
      'available',
      'available',
    ]);
    expect(f.data.conversationArtifactDiscovery).not.toHaveBeenCalled();
    expect(f.data.rag.search).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});

test.each(['conversation', 'research'] as const)(
  'deleting %s invalidates the mixed restored reader',
  async kind => {
    const f = await fixture();
    try {
      const restored = await restoreColdConversationRegistry(f.input);
      if (kind === 'conversation')
        await f.storage.deleteSession('synthetic-session');
      else
        await f.db.database.execute(
          'DELETE FROM research_artifacts WHERE id = ?',
          [1],
        );
      expect(
        (await restored.readSource(f.alias, f.input.signal)).status,
      ).not.toBe('available');
      expect(await restored.revalidateEvidence([f.alias], f.input.signal)).toBe(
        false,
      );
    } finally {
      f.db.close();
    }
  },
);

test('missing mixed dependency fails without generating a substitute alias', async () => {
  const f = await fixture();
  try {
    await expect(
      restoreColdConversationRegistry({
        ...f.input,
        snapshot: {
          ...f.input.snapshot,
          entries: f.input.snapshot.entries.filter(
            row => row.original.sourceId !== f.child.id,
          ),
        },
        sources: [f.parent, f.conversation],
      }),
    ).rejects.toThrow();
    expect(f.data.conversationArtifactDiscovery).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});

test('changed protected conversation revision and cancellation never return saved prose', async () => {
  const f = await fixture();
  try {
    await expect(
      restoreColdConversationRegistry({
        ...f.input,
        sources: [
          f.parent,
          f.child,
          { ...f.conversation, revision: 'different' },
        ],
      }),
    ).rejects.toThrow();
    const restored = await restoreColdConversationRegistry(f.input);
    f.controller.abort();
    expect(
      (await restored.readSource(f.alias, f.input.signal)).status,
    ).not.toBe('available');
  } finally {
    f.db.close();
  }
});
