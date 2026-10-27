import { encounterCanonical } from '@orot/agent-runtime';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { openLocalWorkflowCheckpointSaver } from '../src/agent/localCheckpointSaver';
import { SqlCipherAgentMemoryStorage } from '../src/storage/agentMemoryStorage';
import { runLocalHealthReview } from '../src/agent/healthReview/workflow';
import {
  seedSyntheticHealthReview,
  syntheticHealthReview,
  syntheticReviewSafety,
} from '../src/agent/healthReview/syntheticFixture';

/** Existing three-process native cohort runs the actual adapter, standard tools, SQLCipher and LangGraph saver. */
export async function runHealthReviewPersistenceOperation(
  mode: unknown,
  fixture: unknown,
) {
  if (
    !['seed', 'resume', 'absence'].includes(String(mode)) ||
    typeof fixture !== 'string' ||
    !/^test-persistence-[a-f0-9-]{36}$/i.test(fixture)
  )
    throw new Error('Isolated persistence fixture required.');
  const sourceId = fixture + ':health-review';
  const repository = await openLocalStorage();
  if (mode === 'seed') await seedSyntheticHealthReview(repository, sourceId);
  const synthetic = syntheticHealthReview(
    repository,
    sourceId,
    mode === 'resume',
  );
  const run = (
    clarification?: Parameters<typeof runLocalHealthReview>[0]['clarification'],
  ) =>
    runLocalHealthReview({
      sourceId,
      threadId: sourceId,
      safetyInput: {},
      ...synthetic,
      clarification,
    });
  let result = await run();
  const config = {
    configurable: {
      thread_id: 'health-review:' + encodeURIComponent(sourceId),
    },
  };
  const saver = await openLocalWorkflowCheckpointSaver();
  if (mode === 'seed') {
    if (
      result.status !== 'needs_clarification' ||
      result.pending.safety.category !== 'insufficient_information' ||
      synthetic.modelCalls() ||
      synthetic.toolCalls()
    )
      throw new Error('Safety context must interrupt before inference.');
    const tuple = await saver.getTuple(config);
    if (
      encounterCanonical(tuple?.checkpoint.channel_values.pending) !==
      encounterCanonical(result.pending)
    )
      throw new Error('Pending health review was not durably checkpointed.');
  } else if (mode === 'resume') {
    if (result.status !== 'needs_clarification')
      throw new Error('Restart lost the clarification interrupt.');
    result = await run({
      pending: result.pending,
      safetyInput: syntheticReviewSafety,
    });
    if (
      result.status !== 'review' ||
      result.safety.category !== 'no_triggered_action' ||
      result.review.observedChanges.length !== 1 ||
      result.review.questions.length !== 1 ||
      synthetic.modelCalls() !== 1 ||
      synthetic.toolCalls() !== 2
    )
      throw new Error('Actual resumed review failed.');
    const repeated = await run();
    if (repeated.status !== 'unavailable' || synthetic.modelCalls() !== 1)
      throw new Error(
        'Completed checkpoints must not replay inference or generated text.',
      );
  } else {
    if (result.status !== 'unavailable' || synthetic.modelCalls())
      throw new Error('Terminal restart replayed inference.');
    const tuple = await saver.getTuple(config);
    const values = tuple?.checkpoint.channel_values;
    if (
      !values ||
      !Array.isArray(values.references) ||
      values.references.length !== 2 ||
      encounterCanonical(values).includes('합성 심박 기록을 확인했어요.')
    )
      throw new Error('Checkpoint retained prose or lost evidence identity.');
    await new SqlCipherAgentMemoryStorage(
      await openLocalAgentMemoryDatabase(),
    ).markSourceRemoved(sourceId);
    if (await saver.getTuple(config))
      throw new Error('Logical removal retained the health checkpoint.');
    const removed = await run();
    if (removed.status !== 'stale_evidence' || synthetic.modelCalls())
      throw new Error('Removed source resumed health inference.');
    await repository.sourceRecords.delete(sourceId);
    if (
      (await repository.get('source_record', sourceId)) ||
      (await saver.getTuple(config)) ||
      (await repository.list('health_observation')).some(row =>
        row.provenance.sourceRecordIds.includes(sourceId),
      )
    )
      throw new Error('Fixture cleanup left source-linked health data.');
    return {
      status: result.status,
      modelCalls: synthetic.modelCalls(),
      cleanupVerified: true,
      logicalRemovalVerified: true,
      referenceCount: values.references.length,
    };
  }
  return {
    ...result,
    modelCalls: synthetic.modelCalls(),
    toolCalls: synthetic.toolCalls(),
  };
}
