import { setup, date } from '../testSupport/conversationHistoryDisplayFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test('normal save proves completion; display skips all source data and calculations', async () => {
  const f = await setup();
  try {
    await f.save('plain');
    await f.save('public', {
      sources: [f.external],
      citations: [f.external.reference],
    });
    await f.save('direct', {
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    const period = f.saved.sources[0]!;
    await f.save('period', {
      sources: [period],
      citations: [period.reference],
    });
    const parent = await f.save('parent');
    const rev = fingerprint(parent);
    const inherited = {
      kind: 'generated_conversation' as const,
      id: parent.id,
      revision: rev,
      reference: {
        ...f.personal.reference,
        sourceKind: 'generated_artifact' as const,
        sourceId: parent.id,
        evidenceId: parent.id,
        sourceRevision: rev,
        evidenceRevision: rev,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      },
    };
    await f.save('generated', {
      sources: [inherited],
      citations: [inherited.reference],
    });
    await f.save('partial', { status: 'partial' });
    await f.save('legacy', { citations: undefined }, false);
    await f.save('foreign-row', { sessionId: 'foreign' });
    await f.storage.startRequest({
      id: 'draft',
      sessionId: 'selected',
      sessionVersion: 0,
      question: 'Unsaved',
      createdAt: date,
    });
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-outside',
      effectiveAt: '2026-11-01T00:00:00.000Z',
    });
    const strict = await f.strictCount([
      'plain',
      'public',
      'direct',
      'period',
      'generated',
    ]);
    const slots = await f.display([
      'plain',
      'public',
      'direct',
      'period',
      'generated',
      'partial',
      'legacy',
      'foreign-row',
      'draft',
      'missing',
    ]);
    expect(slots.map(row => row?.id ?? null)).toEqual([
      'plain',
      'public',
      'direct',
      'period',
      'generated',
      'partial',
      'legacy',
      null,
      null,
      null,
    ]);
    expect(slots[2]).toEqual({
      id: 'direct',
      sessionId: 'selected',
      createdAt: date,
      question: 'Synthetic question',
      answer: 'Previously committed synthetic answer',
      status: 'complete',
      savedCitations: [{ kind: 'personal_record', ordinal: 0 }],
    });
    expect(f.sql).toHaveLength(3);
    expect(strict).toBeGreaterThan(f.sql.length);
    console.info('SYNTHETIC_STORED_DISPLAY_SQL', {
      strict,
      display: f.sql.length,
    });
    await f.db.execute(
      "INSERT INTO transcript_artifact_staleness (transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('synthetic-transcript','health_observation',?,'superseded','updated',?)",
      [f.inside.id, date],
    );
    // The existing evidence-aware path refuses changed current evidence. The
    // display retains only the old answer, not its old record or citation.
    await expect(f.storage.read('direct')).resolves.toBeNull();
    expect((await f.display(['direct']))[0]?.id).toBe('direct');
  } finally {
    f.close();
  }
}, 15000);

test('typed deletion and purges, rolled-back deletion, hidden and refreshed lease still govern display', async () => {
  const f = await setup();
  try {
    await f.save('blocked', {
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    await f.save('edge', {
      sources: [f.personal],
      citations: [f.personal.reference],
    });
    await f.save('plain');
    // An absent citation edge is not itself a user deletion.
    await f.db.execute(
      "DELETE FROM conversation_artifact_sources WHERE artifact_id='edge' AND record_kind='identity'",
    );
    expect((await f.display(['edge']))[0]?.id).toBe('edge');
    await expect(
      f.db.transaction(async tx => {
        await tx.execute("DELETE FROM conversation_artifacts WHERE id='plain'");
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await f.display(['plain']))[0]?.id).toBe('plain');
    await f.db.execute('INSERT INTO source_deletion_tombstones VALUES (?)', [
      f.inside.id,
    ]);
    await expect(f.display(['blocked', 'edge'])).resolves.toEqual([null, null]);
    const hiddenVersion = (await f.storage.hideSession('selected', 0))!;
    await expect(f.display(['plain'])).rejects.toThrow('unavailable');
    const nextVersion = await f.storage.undoHiddenSession(
      'selected',
      hiddenVersion,
    );
    await expect(f.display(['plain'])).rejects.toThrow('unavailable');
    expect((await f.display(['plain'], nextVersion))[0]?.id).toBe('plain');
  } finally {
    f.close();
  }
}, 15000);
