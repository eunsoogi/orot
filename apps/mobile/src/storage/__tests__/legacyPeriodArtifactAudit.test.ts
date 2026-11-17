import { createResearchArtifactDiscovery } from '../../aiFeatures/integration/researchArtifactDiscovery';
import { readResearchSource } from '../../aiFeatures/integration/researchSourceReader';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import {
  decodeResearchArtifact,
  readResearchArtifact,
} from '../researchArtifactCodec';
import { createResearchArtifactStorage } from '../researchArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';

test('legacy research with an unidentifiable deleted contributor is quarantined without deleting its snapshot', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const before = (
      await f.database.execute('SELECT * FROM research_artifacts WHERE id=1')
    ).rows[0]!;
    await f.repository.delete('health_observation', 'candidate');
    const current = await f.read(f.window, ['measurements']);
    expect(current.deletionGeneration).not.toBe(f.report.deletionGeneration);
    expect(healthContextRevision(f.source.scope, current)).toBe(
      f.source.revision,
    );
    // Restore an encrypted snapshot left behind by the old contributor trigger policy.
    // No raw source is restored, and no validation function is mocked.
    await f.database.execute(
      'INSERT INTO research_artifacts(id,snapshot_json,search_text) VALUES (?,?,?)',
      [1, before.snapshot_json!, before.search_text!],
    );
    const reopened = createResearchArtifactStorage(f.database);
    expect(await reopened.read(1)).toBeNull();
    expect(await readResearchArtifact(f.database, 'research-1')).toBeNull();
    expect((await reopened.search('', null, 20)).items).toHaveLength(0);
    expect(await reopened.readUnavailableMetadata(1)).toEqual({
      id: 1,
      createdAt: f.saved.createdAt,
      reason: 'unverifiable_legacy_period',
      recovery: 'regenerate',
    });
    const data = {
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(reopened),
    } as AiFeatureLocalData;
    expect(
      await readResearchSource(
        data,
        new LocalEvidenceReferenceRegistry(),
        'research-1',
        'old-revision',
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable', reason: 'unverifiable_legacy_period' });
    expect(
      await reopened.revalidatePage(
        [{ id: 'research-1', revision: 'old-revision' }],
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(
      (
        await f.database.execute(
          'SELECT artifact_id FROM research_artifact_periods WHERE artifact_id=1',
        )
      ).rows,
    ).toHaveLength(1);
    await reopened.rebuildSearchIndex();
    expect(
      (
        await f.database.execute(
          'SELECT snapshot_json FROM research_artifacts WHERE id=1',
        )
      ).rows[0]?.snapshot_json,
    ).toBe(before.snapshot_json);
    const input = decodeResearchArtifact(1, before.snapshot_json)!;
    const freshSources = input.inputSources.map(source => ({
      ...source,
      deletionGeneration: current.deletionGeneration,
    }));
    const ids = await reopened.append(
      [{ ...input, inputSources: freshSources }],
      await reopened.currentGeneration(),
    );
    expect(ids[0]).not.toBe(1);
    expect(await reopened.read(ids[0]!)).not.toBeNull();
    await f.repository.put('health_observation', {
      ...f.candidate,
      id: 'unrelated',
      effectiveAt: '2026-08-01T00:00:00Z',
      endedAt: undefined,
    });
    await f.repository.delete('health_observation', 'unrelated');
    expect(await reopened.read(ids[0]!)).not.toBeNull();
    expect(await reopened.read(1)).toBeNull();
    expect(
      (
        await f.database.execute(
          'SELECT artifact_id FROM research_artifact_periods WHERE artifact_id=1',
        )
      ).rows,
    ).toHaveLength(1);
    await f.repository.delete('health_observation', 'duplicate');
    expect(
      (await f.database.execute('SELECT id FROM research_artifacts WHERE id=1'))
        .rows,
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});
