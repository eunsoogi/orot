import '../src/agent/polyfills';
import { createStatefulTwoNodeGraph } from '@orot/agent-runtime';
import { createWorkflowCheckpointConfig } from '../src/agent/checkpointIdentity';
import { openLocalWorkflowCheckpointSaver } from '../src/agent/localCheckpointSaver';

const checkpointNote = '환자 기록: café 🌱🩺';

/** Exercise the production SQLCipher saver across host processes; only the synthetic thread is owned by this test. */
export async function runCheckpointPersistenceOperation(
  mode: unknown,
  fixtureIdentifier: unknown,
): Promise<Record<string, unknown>> {
  if (
    !['save', 'resume'].includes(String(mode)) ||
    typeof fixtureIdentifier !== 'string' ||
    !/^test-persistence-[a-f0-9-]{36}$/i.test(fixtureIdentifier)
  )
    throw new Error('Checkpoint persistence requires its isolated host phase');
  const config = createWorkflowCheckpointConfig(
    'visit-question',
    fixtureIdentifier,
  );
  const saver = await openLocalWorkflowCheckpointSaver();
  if (mode === 'save') {
    await saver.deleteThread(config.configurable.thread_id);
    const state = await createStatefulTwoNodeGraph({
      checkpointer: saver,
      interruptAfter: ['increment'],
    }).invoke({ value: 3 }, config);
    const tuple = await saver.getTuple(config);
    if (!tuple)
      throw new Error(
        'The SQLCipher saver did not return the saved checkpoint',
      );
    const metadata = {
      ...(tuple.metadata ?? {}),
      checkpointNote,
    } as unknown as NonNullable<typeof tuple.metadata>;
    await saver.put(
      tuple.parentConfig ?? config,
      tuple.checkpoint,
      metadata,
      {},
    );
    const saved = await saver.getTuple(config);
    const note = (saved?.metadata as unknown as Record<string, unknown>)
      ?.checkpointNote;
    if (
      state.value !== 4 ||
      state.nodeRuns.join(',') !== 'increment' ||
      note !== checkpointNote
    )
      throw new Error(
        'Checkpoint save changed the completed node or UTF-8 metadata',
      );
    return { value: state.value, nodeRuns: state.nodeRuns, note };
  }
  const restored = await saver.getTuple(config);
  const note = (restored?.metadata as unknown as Record<string, unknown>)
    ?.checkpointNote;
  if (note !== checkpointNote)
    throw new Error('The saved UTF-8 metadata did not restore');
  const state = await createStatefulTwoNodeGraph({
    checkpointer: saver,
  }).invoke(null, config);
  if (state.value !== 8 || state.nodeRuns.join(',') !== 'increment,double')
    throw new Error('The saved node ran again or the workflow state changed');
  await saver.deleteThread(config.configurable.thread_id);
  return { value: state.value, nodeRuns: state.nodeRuns, note, cleaned: true };
}
