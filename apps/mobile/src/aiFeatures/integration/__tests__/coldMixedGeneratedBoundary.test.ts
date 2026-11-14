import { coldMixedGeneratedFixture as fixture } from '../testSupport/coldMixedGeneratedFixture';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { readColdGeneratedSnapshot } from '../coldGeneratedSnapshot';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';

test('a research child can resolve a conversation parent and its research ancestry without alias allocation', async () => {
  const f = await fixture();
  try {
    const original = (await f.researchStorage.read(1))!;
    await f.researchStorage.append(
      [{ ...original, inputSources: [f.conversation] }],
      await f.researchStorage.currentGeneration(),
    );
    const value = (await f.discovery.read('research-3'))!;
    const source = {
      ...f.child,
      id: value.metadata.id,
      revision: value.metadata.revision,
      reference: {
        ...f.child.reference,
        sourceId: value.metadata.id,
        evidenceId: value.metadata.id,
        sourceRevision: value.metadata.revision,
        evidenceRevision: value.metadata.revision,
      },
    };
    const alias = f.add(source);
    const snapshot = f.original.snapshot();
    const restored = await restoreColdConversationRegistry({
      ...f.input,
      snapshot,
      sources: [...f.input.sources, source],
    });
    const read = await restored.readSource(alias, f.input.signal);
    if (
      read.status !== 'available' ||
      read.document.sourceKind !== 'generated_artifact' ||
      !('research' in read.document)
    )
      throw new Error('Missing research');
    expect(read.document.sources).toContainEqual(referenceOnly(f.alias));
    expect(restored.snapshot()).toEqual(snapshot);
    await f.storage.deleteSession('synthetic-session');
    expect((await restored.readSource(alias, f.input.signal)).status).not.toBe(
      'available',
    );
  } finally {
    f.db.close();
  }
});

test('deletion during a mixed dependency read prevents the parent prose from escaping', async () => {
  const f = await fixture();
  try {
    const restored = await restoreColdConversationRegistry(f.input);
    const read = f.discovery.read.bind(f.discovery);
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const value = await read(id, signal);
      await f.storage.deleteSession('synthetic-session');
      return value;
    });
    expect(
      (await restored.readSource(f.alias, f.input.signal)).status,
    ).not.toBe('available');
  } finally {
    f.db.close();
  }
});

test.each(['legacy', 'treatment', 'photo', 'citation'] as const)(
  'rejects unsupported %s snapshot before returning prose',
  async kind => {
    const f = await fixture();
    try {
      const saved = (await f.storage.read(f.conversation.id))!;
      // Inject malformed/unsupported persisted projections at the reader boundary, not a real user record.
      const value =
        kind === 'legacy'
          ? { ...saved, citations: undefined }
          : kind === 'treatment'
            ? { ...saved, treatmentContext: {} }
            : kind === 'photo'
              ? { ...saved, sources: [{ kind: 'conversation_photo' }] }
              : {
                  ...saved,
                  citations: [{ ...f.child.reference, evidenceId: 'missing' }],
                };
      jest.spyOn(f.storage, 'read').mockResolvedValue(value as typeof saved);
      expect(
        await readColdGeneratedSnapshot(f.conversation, f.data, f.input.signal),
      ).toBeNull();
    } finally {
      f.db.close();
    }
  },
);
