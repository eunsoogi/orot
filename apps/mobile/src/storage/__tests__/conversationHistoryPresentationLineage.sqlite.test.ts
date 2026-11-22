import { createResearchArtifactStorage } from '../researchArtifactStorage';
import { setup, date } from '../testSupport/conversationHistoryDisplayFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test('metadata-only same-session ancestors honor actual ancestor Hide and durable purge without loading parent text', async () => {
  const f = await setup();
  try {
    const parent = await f.save('parent');
    const other = await f.save('other-parent', { sessionId: 'foreign' });
    const linked = (value: typeof parent) => {
      const revision = fingerprint(value);
      return {
        kind: 'generated_conversation' as const,
        id: value.id,
        revision,
        reference: {
          ...f.personal.reference,
          sourceKind: 'generated_artifact' as const,
          sourceId: value.id,
          evidenceId: value.id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: { kind: 'generated_artifact', type: 'conversation_turn' },
        },
      };
    };
    const edge = linked(parent);
    const middle = await f.save('middle', {
      sources: [edge],
      citations: [edge.reference],
    });
    const deeper = linked(middle);
    await f.save('deeper', {
      sources: [deeper],
      citations: [deeper.reference],
    });
    expect((await f.display(['middle', 'deeper'])).map(row => row?.id)).toEqual(
      ['middle', 'deeper'],
    );
    const crossEdge = linked(other);
    await f.save('foreign-link', {
      sources: [crossEdge],
      citations: [crossEdge.reference],
    });
    expect((await f.display(['foreign-link']))[0]?.id).toBe('foreign-link');
    await f.storage.hideSession('foreign', 0);
    // Soft Hide leaves the referencing row in SQLite; it remains withheld.
    expect(
      (
        await f.db.execute(
          "SELECT id FROM conversation_artifacts WHERE id='foreign-link'",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(f.display(['foreign-link'])).resolves.toEqual([null]);
    await f.db.execute("DELETE FROM conversation_artifacts WHERE id='parent'");
    await expect(f.display(['middle', 'deeper'])).resolves.toEqual([
      null,
      null,
    ]);
  } finally {
    f.close();
  }
}, 15000);

test('period display ignores new readings and unrelated deletions, but respects actual persisted purge', async () => {
  const f = await setup();
  try {
    const period = f.saved.sources[0]!;
    await f.save('period', {
      sources: [period],
      citations: [period.reference],
    });
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'later-outside',
      effectiveAt: '2026-11-13T00:00:00.000Z',
    });
    expect((await f.display(['period']))[0]?.id).toBe('period');
    // An unrelated deletion does not redact an independently saved answer.
    await f.db.execute(
      "DELETE FROM health_observations WHERE id='later-outside'",
    );
    expect(
      (
        await f.db.execute(
          "SELECT id FROM conversation_artifacts WHERE id='period'",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await f.display(['period']))[0]?.id).toBe('period');
    await f.db.execute('DELETE FROM health_observations WHERE id=?', [
      f.inside.id,
    ]);
    await expect(f.display(['period'])).resolves.toEqual([null]);
  } finally {
    f.close();
  }
}, 15000);

test('legacy summary and research replies stay visible after freshness quarantine, but not explicit deletion', async () => {
  const f = await setup();
  try {
    await f.summaryStorage.append(f.saved);
    const revision = fingerprint(f.saved);
    const source = {
      kind: 'generated_summary' as const,
      id: f.saved.id,
      revision,
      reference: {
        ...f.personal.reference,
        sourceKind: 'generated_artifact' as const,
        sourceId: f.saved.id,
        evidenceId: f.saved.id,
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'symptom_summary' },
      },
    };
    await f.save('summary-dependent', {
      sources: [source],
      citations: [source.reference],
    });
    await f.db.execute(
      "UPDATE summary_period_policy SET status='quarantined' WHERE summary_id=?",
      [f.saved.id],
    );
    expect(
      (
        await f.db.execute(
          "SELECT id FROM conversation_artifacts WHERE id='summary-dependent'",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await f.display(['summary-dependent']))[0]?.id).toBe(
      'summary-dependent',
    );
    const research = createResearchArtifactStorage(f.db);
    await research.append(
      [
        {
          createdAt: date,
          originFeature: 'medical_literature',
          providerId: null,
          modelId: null,
          source: {
            kind: 'publication',
            title: 'Archived publication',
            url: 'https://europepmc.org/article/MED/123',
            status: 'historical_snapshot',
            retrievedAt: date,
          },
          generatedText: null,
        },
      ],
      await research.currentGeneration(),
    );
    const researchRevision = fingerprint(await research.read(1));
    const reference = {
      ...source.reference,
      sourceId: 'research-1',
      evidenceId: 'research-1',
      sourceRevision: researchRevision,
      evidenceRevision: researchRevision,
      locator: { kind: 'generated_artifact', type: 'research_publication' },
    };
    await f.save(
      'old-research',
      {
        sources: [
          {
            kind: 'generated_research',
            id: 'research-1',
            revision: researchRevision,
            reference,
          },
        ],
        citations: [reference],
      },
      false,
    );
    expect(
      (await f.display(['summary-dependent', 'old-research'])).map(
        row => row?.id,
      ),
    ).toEqual(['summary-dependent', 'old-research']);
    await research.remove(1);
    await f.db.execute('DELETE FROM symptom_summary_runs WHERE id=?', [
      f.saved.id,
    ]);
    await expect(
      f.display(['summary-dependent', 'old-research']),
    ).resolves.toEqual([null, null]);
  } finally {
    f.close();
  }
}, 15000);
