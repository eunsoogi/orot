import '../src/agent/polyfills';
import { useState } from 'react';
import { AppRegistry, Button, StyleSheet, Text, View } from 'react-native';
import { createStatefulTwoNodeGraph } from '@orot/agent-runtime';
import { name as appName } from '../app.json';
import { createWorkflowCheckpointConfig } from '../src/agent/checkpointIdentity';
import { openLocalWorkflowCheckpointSaver } from '../src/agent/localCheckpointSaver';

const checkpointNote = '환자 기록: café 🌱🩺';
const config = createWorkflowCheckpointConfig(
  'visit-question',
  'detox-thread-42',
);
type ProbeStatus = 'ready' | 'running' | 'saved' | 'complete' | 'failure';

function CheckpointProbeEntry() {
  const [status, setStatus] = useState<ProbeStatus>('ready');
  const [detail, setDetail] = useState('');

  async function startCheckpoint() {
    setStatus('running');
    try {
      const saver = await openLocalWorkflowCheckpointSaver();
      await saver.deleteThread(config.configurable.thread_id);
      const graph = createStatefulTwoNodeGraph({
        checkpointer: saver,
        interruptAfter: ['increment'],
      });
      const state = await graph.invoke({ value: 3 }, config);
      const tuple = await saver.getTuple(config);
      if (!tuple)
        throw new Error(
          'The SQLCipher saver did not return the saved checkpoint.',
        );
      // Seed text in the persisted metadata to exercise UTF-8 serialization on device.
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
      const savedTuple = await saver.getTuple(config);
      const savedNote = savedTuple?.metadata
        ? (savedTuple.metadata as unknown as Record<string, unknown>)
            .checkpointNote
        : undefined;
      if (
        state.value !== 4 ||
        state.nodeRuns.join(',') !== 'increment' ||
        savedNote !== checkpointNote
      ) {
        throw new Error(
          `Unexpected saved graph state: value=${state.value}; nodes=${state.nodeRuns.join(',')}; note=${String(savedNote)}`,
        );
      }
      setStatus('saved');
    } catch (error) {
      reportFailure(error, setDetail, setStatus);
    }
  }

  async function resumeCheckpoint() {
    setStatus('running');
    try {
      const saver = await openLocalWorkflowCheckpointSaver();
      const restoredTuple = await saver.getTuple(config);
      const restoredNote = restoredTuple?.metadata
        ? (restoredTuple.metadata as unknown as Record<string, unknown>)
            .checkpointNote
        : undefined;
      if (restoredNote !== checkpointNote) {
        throw new Error(
          `The saved UTF-8 metadata did not restore: note=${String(restoredNote)}`,
        );
      }
      const state = await createStatefulTwoNodeGraph({
        checkpointer: saver,
      }).invoke(null, config);
      if (
        state.value !== 8 ||
        state.nodeRuns.join(',') !== 'increment,double'
      ) {
        throw new Error(
          `The saved node ran again or the workflow state changed: value=${state.value}; nodes=${state.nodeRuns.join(',')}`,
        );
      }
      setDetail(`value=8; nodes=increment,double; note=${checkpointNote}`);
      setStatus('complete');
    } catch (error) {
      reportFailure(error, setDetail, setStatus);
    }
  }

  return (
    <View style={styles.container}>
      <Text testID={'checkpoint-' + status} accessibilityRole="header">
        LangGraph checkpoint: {status}
      </Text>
      {status !== 'running' && (
        <Button
          testID="checkpoint-start"
          title="Save checkpoint"
          onPress={startCheckpoint}
        />
      )}
      {status !== 'running' && (
        <Button
          testID="checkpoint-resume"
          title="Resume checkpoint"
          onPress={resumeCheckpoint}
        />
      )}
      {status === 'complete' && (
        <Text testID="checkpoint-result">{detail}</Text>
      )}
      {status === 'failure' && <Text testID="checkpoint-result">{detail}</Text>}
    </View>
  );
}

function reportFailure(
  error: unknown,
  setDetail: (detail: string) => void,
  setStatus: (status: ProbeStatus) => void,
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('LangGraph checkpoint probe failed:', error);
  setDetail(message);
  setStatus('failure');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

AppRegistry.registerComponent(appName, () => CheckpointProbeEntry);
