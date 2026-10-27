import {
  approvalFor,
  sourceId,
  threadId,
  time,
  sqliteEncounterFixture,
} from '../__fixtures__/sqliteFixture';
import { persistEncounterApproval } from '../persistence';
import { createLangGraphCheckpointStorage } from '@orot/storage';

describe('Encounter canonical SQLite integration', () => {
  const { repository, run, pending, reopen, database } =
    sqliteEncounterFixture();
  it('reopens a real file, restores exact pending identity, applies edited approval and reopens saved evidence', async () => {
    const savedPending = await pending();
    expect(await repository().list('health_observation')).toEqual([]);
    reopen();
    const resumed = run(false);
    expect(await resumed.result).toEqual({
      status: 'pending',
      pending: savedPending,
    });
    expect(resumed.synthetic.calls()).toBe(0);
    const approval = approvalFor(savedPending);
    approval.candidates = approval.candidates.map(candidate => ({
      ...candidate,
      text: 'Edited ' + candidate.text,
    }));
    expect((await run(false, approval).result).status).toBe('saved');
    reopen();
    expect((await run(false).result).status).toBe('saved');
    const records = await repository().list('health_observation');
    expect(records).toHaveLength(2);
    expect(
      records.every(
        record =>
          record.reviewState.status === 'reviewed' &&
          record.provenance.origin === 'derived' &&
          record.provenance.source?.sourceName === 'speaker:unknown',
      ),
    ).toBe(true);
    const spans =
      await repository().evidenceSpans.listForSourceRecord(sourceId);
    expect(spans).toHaveLength(4);
    expect(
      spans
        .filter(span => span.locator?.kind === 'text_range')
        .map(span => ({ text: span.text, locator: span.locator })),
    ).toEqual(
      savedPending.candidates.map(candidate => ({
        text: candidate.evidence[0].quote,
        locator: {
          kind: 'text_range',
          startOffset: candidate.evidence[0].startOffset,
          endOffset: candidate.evidence[0].endOffset,
        },
      })),
    );
    expect(
      spans.every(
        span =>
          span.provenance.source?.sourceIdentifier === sourceId + ':segment:r1',
      ),
    ).toBe(true);
    expect(await repository().list('medication_assertion')).toEqual([]);
  });

  it('replays the committed write receipt without adding rows and refuses a changed approval', async () => {
    const savedPending = await pending();
    const approval = approvalFor(savedPending);
    const signal = new AbortController().signal;
    const first = await persistEncounterApproval(
      repository(),
      savedPending,
      approval,
      signal,
    );
    expect(
      await persistEncounterApproval(
        repository(),
        savedPending,
        approval,
        signal,
      ),
    ).toEqual(first);
    expect(await repository().list('health_observation')).toHaveLength(2);
    expect(await repository().list('evidence_span')).toHaveLength(4);
    await expect(
      persistEncounterApproval(
        repository(),
        savedPending,
        {
          ...approval,
          candidates: [{ ...approval.candidates[0], text: 'Other text' }],
        },
        signal,
      ),
    ).rejects.toThrow('different committed approval');
  });

  it('detects dose conflicts and does not overwrite the older assertion', async () => {
    await repository().put('medication_assertion', {
      id: 'prior-medication',
      effectiveAt: time,
      recordedAt: time,
      ingestedAt: time,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      assertionKind: 'current_medication_confirmation',
      confirmedByUserId: 'synthetic-user',
      medicationName: '합성약',
      dosageInstruction: '10 mg',
    });
    const savedPending = await pending();
    expect(savedPending.conflicts).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-0',
        recordId: 'prior-medication',
      }),
    ]);
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'saved',
    );
    expect(
      (await repository().get('medication_assertion', 'prior-medication'))
        ?.dosageInstruction,
    ).toBe('10 mg');
  });

  it('refuses a source correction or deletion after the confirmation snapshot', async () => {
    const savedPending = await pending();
    await repository().transcripts.correct(
      sourceId + ':segment:r1',
      'Corrected synthetic text',
      time,
    );
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'unavailable',
    );
    expect(await repository().list('health_observation')).toHaveLength(0);
    await repository().sourceRecords.delete(sourceId);
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'unavailable',
    );
  });

  it('rolls back records, evidence and receipt when cancellation arrives within the transaction', async () => {
    const savedPending = await pending();
    const controller = new AbortController();
    const records = repository();
    const transaction = records.transaction.bind(records);
    records.transaction = operation =>
      transaction(async (writer, sql) => {
        const put = writer.put.bind(writer);
        writer.put = async (...args) => {
          await put(...args);
          controller.abort();
        };
        return operation(writer, sql);
      });
    await expect(
      persistEncounterApproval(
        records,
        savedPending,
        approvalFor(savedPending),
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(await repository().list('health_observation')).toEqual([]);
    expect(await repository().list('evidence_span')).toEqual([]);
    expect(
      await repository().getSyncCheckpoint(
        'encounter-approval:' + encodeURIComponent(threadId),
      ),
    ).toBeNull();
  });

  it('refuses conflict changes between display and commit', async () => {
    const savedPending = await pending();
    await repository().put('health_observation', {
      id: 'new-plan',
      effectiveAt: time,
      recordedAt: time,
      ingestedAt: time,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'other',
      concept: 'encounter_plan',
      value: { kind: 'text', text: 'A different follow-up plan' },
    });
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'unavailable',
    );
    expect(await repository().list('evidence_span')).toEqual([]);
  });

  it('erases source-linked checkpoints and approval receipts and fences late checkpoint writes', async () => {
    const savedPending = await pending();
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'saved',
    );
    const receiptKey = 'encounter-approval:' + encodeURIComponent(threadId);
    expect(await repository().getSyncCheckpoint(receiptKey)).not.toBeNull();
    await repository().putSyncCheckpoint({
      key: 'foreign-cursor',
      value: 'non-json cursor',
      updatedAt: time,
    });
    const storage = createLangGraphCheckpointStorage(database(), {
      sourceRecordId: sourceId,
    });
    const graphThread = 'encounter:' + encodeURIComponent(threadId);
    expect((await storage.listCheckpoints(graphThread)).length).toBeGreaterThan(
      0,
    );
    await repository().sourceRecords.delete(sourceId);
    expect(await storage.listCheckpoints(graphThread)).toEqual([]);
    expect(await repository().getSyncCheckpoint(receiptKey)).toBeNull();
    expect(
      (await repository().getSyncCheckpoint('foreign-cursor'))?.value,
    ).toBe('non-json cursor');
    await expect(
      storage.saveWrites(graphThread, '', 'late-checkpoint', [
        {
          taskId: 'late-task',
          index: 0,
          channel: 'pending',
          type: 'json',
          value: new Uint8Array([1]),
          replaceExisting: false,
        },
      ]),
    ).rejects.toThrow('source was removed');
    expect(await storage.listCheckpoints(graphThread)).toEqual([]);
  });
});
