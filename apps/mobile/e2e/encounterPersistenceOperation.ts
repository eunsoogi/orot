import { encounterCanonical } from '@orot/agent-runtime';
import {
  openLocalStorage,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';
import { openLocalWorkflowCheckpointSaver } from '../src/agent/localCheckpointSaver';
import { runLocalEncounterProcessing } from '../src/agent/encounter/workflow';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
  syntheticEncounterText,
  syntheticEncounterTime,
} from '../src/agent/encounter/syntheticFixture';

/** Called by the canonical three-process XCTest cohort, without an in-memory saver or SQLCipher replacement. */
export async function runEncounterPersistenceOperation(
  mode: unknown,
  fixture: unknown,
) {
  if (
    !['seed', 'resume', 'absence'].includes(String(mode)) ||
    typeof fixture !== 'string' ||
    !/^test-persistence-[a-f0-9-]{36}$/i.test(fixture)
  )
    throw new Error(
      'Encounter persistence requires the isolated native persistence fixture.',
    );
  const sourceId = fixture + ':encounter';
  const threadId = sourceId;
  const repository = await openLocalStorage();
  const synthetic = syntheticEncounterModel(sourceId, mode === 'seed');
  const run = (
    approval?: Parameters<typeof runLocalEncounterProcessing>[0]['approval'],
  ) =>
    runLocalEncounterProcessing({
      threadId,
      sourceId,
      model: synthetic.model,
      approval,
    });
  if (mode === 'seed') {
    await seedSyntheticEncounter(repository, sourceId);
    const result = await run();
    if (result.status !== 'pending')
      throw new Error('The actual encounter graph did not interrupt.');
    const rows = (await repository.list('health_observation')).filter(record =>
      record.provenance.sourceRecordIds.includes(sourceId),
    );
    if (rows.length)
      throw new Error(
        'Encounter graph wrote confirmed facts before a host approval.',
      );
    const saver = await openLocalWorkflowCheckpointSaver();
    const tuple = await saver.getTuple({
      configurable: { thread_id: 'encounter:' + encodeURIComponent(threadId) },
    });
    if (
      encounterCanonical(tuple?.checkpoint.channel_values.pending) !==
      encounterCanonical(result.pending)
    )
      throw new Error('Pending identity was not durably checkpointed.');
    return {
      status: result.status,
      pending: result.pending,
      recordCount: rows.length,
      modelCalls: synthetic.calls(),
    };
  }
  let result = await run();
  if (mode === 'resume') {
    if (result.status !== 'pending')
      throw new Error('New process lost its confirmation interrupt.');
    const pending = result.pending;
    if (
      pending.candidates.length !== 2 ||
      pending.candidates.some(candidate => candidate.speaker !== 'unknown')
    )
      throw new Error(
        'Saved extraction identity or speaker uncertainty changed.',
      );
    // A newly rendered host approval is required after restart; edit only a candidate's display text.
    result = await run({
      pending,
      decision: 'approve',
      candidates: pending.candidates.map(candidate =>
        candidate.kind === 'medication'
          ? { ...candidate, text: '사용자가 검토한 합성약 언급' }
          : candidate,
      ),
      reviewerId: 'synthetic-user',
      reviewedAt: syntheticEncounterTime,
    });
    if (result.status !== 'saved')
      throw new Error('Explicit approval did not commit through the graph.');
    const repeated = await run();
    if (encounterCanonical(repeated) !== encounterCanonical(result))
      throw new Error('Duplicate resume changed the result.');
  }
  if (result.status !== 'saved' || result.recordIds.length !== 2)
    throw new Error('Committed graph records did not survive process restart.');
  const records = await Promise.all(
    result.recordIds.map(id => repository.get('health_observation', id)),
  );
  const evidence = await repository.evidenceSpans.listForSourceRecord(sourceId);
  if (
    records.some(
      record =>
        !record ||
        record.reviewState.status !== 'reviewed' ||
        record.provenance.origin !== 'derived' ||
        record.provenance.source?.sourceName !== 'speaker:unknown',
    ) ||
    evidence.length !== 4 ||
    synthetic.calls() !== 0
  )
    throw new Error(
      'Native readback lost reviewed records, evidence or extraction replay protection.',
    );
  for (const span of evidence) {
    if (
      span.locator?.kind === 'text_range' &&
      span.text !==
        syntheticEncounterText.slice(
          span.locator.startOffset,
          span.locator.endOffset,
        )
    )
      throw new Error(
        'Persisted evidence no longer matches its exact transcript quote.',
      );
    if (span.provenance.source?.sourceIdentifier !== sourceId + ':segment:r1')
      throw new Error('Persisted evidence lost its exact transcript revision.');
  }
  const receipt = {
    status: result.status,
    recordIds: result.recordIds,
    records,
    evidence,
    modelCalls: synthetic.calls(),
  };
  if (mode === 'absence') {
    // Only the exact fixture's rows and checkpoint are removed; all unrelated native persistence fixtures survive.
    for (const id of result.recordIds)
      await repository.delete('health_observation', id);
    for (const span of evidence)
      await repository.delete('evidence_span', span.id);
    await repository.delete('transcript_segment', sourceId + ':segment:r1');
    await repository.delete('source_record', sourceId);
    await (
      await openLocalWorkflowCheckpointSaver()
    ).deleteThread('encounter:' + encodeURIComponent(threadId));
    const database = await openLocalAgentMemoryDatabase();
    await database.execute(
      'DELETE FROM healthkit_sync_checkpoints WHERE checkpoint_key = ?',
      ['encounter-approval:' + encodeURIComponent(threadId)],
    );
    if (
      (await repository.get('source_record', sourceId)) ||
      (await repository.evidenceSpans.listForSourceRecord(sourceId)).length ||
      (
        await Promise.all(
          result.recordIds.map(id => repository.get('health_observation', id)),
        )
      ).some(Boolean)
    )
      throw new Error(
        'Task-owned encounter cleanup did not remove its stored fixtures.',
      );
  }
  return receipt;
}
