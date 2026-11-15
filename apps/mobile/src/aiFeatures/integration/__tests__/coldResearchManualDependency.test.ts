import { requireNonPhotoSources } from '../../../ragConversation/conversationArtifactSources';
import { createManualHistoryRepository } from '@orot/storage';
import { coldResearchRegistryFixture as fixture } from '../testSupport/coldResearchRegistryFixture';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildManualHistoryEvidence } from '../manualHistoryEvidence';
import { captureConversationSources } from '../captureConversationSources';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import type { SavedGeneratedResearchSource } from '../../../diseaseHypotheses/savedSummaries';

/** Real SQLite local-note lineage exercises the cold reader's nonresearch owner.readSource branch. */
test('manual-history dependency opens in the returned owner and deletion invalidates its research child', async () => {
  const f = await fixture();
  try {
    const history = createManualHistoryRepository(f.db.database);
    const note = await history.create({
      kind: 'note',
      title: 'Synthetic note',
      details: 'Synthetic local dependency',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(note.id);
    if (!evidence) throw new Error('Missing local fixture');
    const original = new LocalEvidenceReferenceRegistry();
    const item = buildManualHistoryEvidence({
      candidates: [evidence],
      repository: history,
      registry: original,
    }).items[0]!;
    const captured = await captureConversationSources(
      [item],
      original,
      f.input.signal,
    );
    await f.storage.append(
      [
        {
          createdAt: '2026-10-05T00:00:00.000Z',
          originFeature: 'symptom_summary',
          providerId: 'provider',
          modelId: 'model',
          source: {
            kind: 'public_web_search',
            status: 'historical_snapshot',
            retrievedAt: '2026-10-05T00:00:00.000Z',
            sources: [
              { title: 'Synthetic source', url: 'https://example.org' },
            ],
          },
          generatedText: 'Synthetic derived research',
          inputSources: requireNonPhotoSources(captured.sources),
        },
      ],
      await f.storage.currentGeneration(),
    );
    const child = await f.discovery.read('research-3');
    if (!child) throw new Error('Missing research fixture');
    const source: SavedGeneratedResearchSource = {
      kind: 'generated_research',
      id: child.metadata.id,
      revision: child.metadata.revision,
      reference: {
        sourceKind: 'generated_artifact',
        sourceId: child.metadata.id,
        evidenceId: child.metadata.id,
        sourceRevision: child.metadata.revision,
        evidenceRevision: child.metadata.revision,
        locator: { kind: 'generated_artifact', type: child.metadata.type },
        effectiveTime: null,
        reviewState: 'unknown',
      },
    };
    const alias = original.add({
      reference: source.reference,
      content: '',
      validate: async () => true,
      readSource: async () => ({ status: 'unavailable' }),
    });
    const restored = await restoreColdConversationRegistry({
      snapshot: original.snapshot(),
      sources: [...captured.sources, source],
      data: { ...f.data, manualHistory: history },
      signal: f.input.signal,
    });
    const before = restored.snapshot();
    const result = await restored.readSource(alias, f.input.signal);
    if (
      result.status !== 'available' ||
      result.document.sourceKind !== 'generated_artifact' ||
      !('research' in result.document)
    )
      throw new Error('Missing research detail');
    const dependency = result.document.sources.find(
      value => value.sourceKind !== 'external_medical',
    )!;
    expect(restored.resolve(dependency)).toEqual(original.resolve(item));
    expect((await restored.readSource(dependency, f.input.signal)).status).toBe(
      'available',
    );
    expect(restored.snapshot()).toEqual(before);
    await history.delete(note.id);
    expect(
      (await restored.readSource(dependency, f.input.signal)).status,
    ).not.toBe('available');
    expect((await restored.readSource(alias, f.input.signal)).status).not.toBe(
      'available',
    );
    expect(await restored.revalidateEvidence([alias], f.input.signal)).toBe(
      false,
    );
  } finally {
    f.db.close();
  }
});
