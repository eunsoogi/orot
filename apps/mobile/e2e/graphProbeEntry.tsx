import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { runGraphIntegrationProbe } from './graphIntegrationProbe';
import { name as appName } from '../app.json';

function GraphProbeEntry() {
  const [status, setStatus] = useState<'running' | 'success' | 'failure'>(
    'running',
  );
  const [failure, setFailure] = useState('');

  useEffect(() => {
    runGraphIntegrationProbe().then(
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
