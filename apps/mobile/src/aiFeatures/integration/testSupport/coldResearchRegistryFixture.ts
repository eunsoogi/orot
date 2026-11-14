import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { SavedGeneratedResearchSource } from '../../../diseaseHypotheses/savedSummaries';

/** Real local SQLite parent/child snapshots. No provider, network, device or user data. */
export async function coldResearchRegistryFixture() {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    const generation = await storage.currentGeneration();
    const item = {
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'symptom_summary',
      providerId: 'provider',
      modelId: 'model',
      source: {
        kind: 'public_web_search' as const,
        status: 'historical_snapshot' as const,
        retrievedAt: '2026-10-05T00:00:00.000Z',
        sources: [{ title: 'Synthetic source', url: 'https://example.org' }],
      },
      generatedText: 'Synthetic explanation',
    };
    const discovery = createResearchArtifactDiscovery(storage);
    const source = async (
      id: string,
    ): Promise<SavedGeneratedResearchSource> => {
      const value = await discovery.read(id);
      if (!value) throw new Error('Missing synthetic research');
      return {
        kind: 'generated_research',
        id,
        revision: value.metadata.revision,
        reference: {
          sourceKind: 'generated_artifact',
          sourceId: id,
          evidenceId: id,
          sourceRevision: value.metadata.revision,
          evidenceRevision: value.metadata.revision,
          locator: { kind: 'generated_artifact', type: value.metadata.type },
          effectiveTime: null,
          reviewState: 'unknown',
        },
      };
    };
    await storage.append([item], generation);
    const parent = await source('research-1');
    await storage.append([{ ...item, inputSources: [parent] }], generation);
    const child = await source('research-2');
    const data = {
      ...localData([]).data,
      researchArtifactDiscovery: async () => discovery,
    };
    const original = new LocalEvidenceReferenceRegistry();
    const add = (value: SavedGeneratedResearchSource) =>
      original.add({
        reference: value.reference,
        content: '',
        validate: async () => true,
        readSource: async () => ({ status: 'unavailable' }),
      });
    const parentAlias = add(parent),
      childAlias = add(child);
    const controller = new AbortController();
    const input = {
      snapshot: original.snapshot(),
      sources: [parent, child],
      data,
      signal: controller.signal,
    };
    return {
      db,
      storage,
      discovery,
      parent,
      child,
      parentAlias,
      childAlias,
      original,
      add,
      data,
      controller,
      input,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
