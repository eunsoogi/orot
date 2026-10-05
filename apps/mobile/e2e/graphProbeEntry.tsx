import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { createStatefulTwoNodeGraph } from '@orot/agent-runtime';
import type { AgentGraphState } from '@orot/agent-runtime';
import { name as appName } from '../app.json';

const RUNS = 20;
const expectedNodeRuns = ['increment', 'double'];

function assertState(
  label: string,
  state: AgentGraphState,
  expectedValue: number,
  nodeRuns: string[],
) {
  if (
    state.value !== expectedValue ||
    state.nodeRuns.join(',') !== nodeRuns.join(',')
  ) {
    throw new Error(
      label +
        ' returned value=' +
        state.value +
        ', nodes=' +
        state.nodeRuns.join(','),
    );
  }
}

async function runGraphSmoke() {
  const graph = createStatefulTwoNodeGraph();
  for (let input = 0; input < RUNS; input += 1) {
    let phase = 'invoke';
    try {
      assertState(
        phase + ' ' + input,
        await graph.invoke({ value: input }),
        (input + 1) * 2,
        expectedNodeRuns,
      );
      const states: AgentGraphState[] = [];
      phase = 'stream';
      for await (const state of await graph.stream(
        { value: input },
        { streamMode: 'values' },
      )) {
        states.push(state);
      }
      if (states.length !== expectedNodeRuns.length + 1) {
        throw new Error(
          'stream ' + input + ' returned ' + states.length + ' states',
        );
      }
      assertState('stream initial ' + input, states[0], input, []);
      assertState('stream increment ' + input, states[1], input + 1, [
        'increment',
      ]);
      assertState(
        'stream double ' + input,
        states[2],
        (input + 1) * 2,
        expectedNodeRuns,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      throw new Error(phase + ' ' + input + ': ' + detail);
    }
  }
}

function GraphProbeEntry() {
  const [status, setStatus] = useState<'running' | 'success' | 'failure'>(
    'running',
  );
  const [failure, setFailure] = useState('');

  useEffect(() => {
    runGraphSmoke().then(
      () => setStatus('success'),
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('LangGraph Hermes probe failed:', error);
        setFailure(message);
        setStatus('failure');
      },
    );
  }, []);

  const message =
    status === 'success'
      ? 'Hermes graph passed: 20/20 invocations and streams, no duplicate nodes'
      : status === 'failure'
        ? 'Hermes graph failed: ' + failure
        : 'Hermes graph running: 0/20';

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        testID={
          status === 'running' ? 'agent-graph-running' : 'agent-graph-' + status
        }
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

AppRegistry.registerComponent(appName, () => GraphProbeEntry);
