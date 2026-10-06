import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { name as appName } from '../app.json';
import {
  runIssue25HybridRetrievalProbe,
  type Issue25HybridProbeResult,
} from './issue25HybridRetrievalProbe';

type ProbeState =
  | { readonly status: 'running' }
  | { readonly status: 'complete'; readonly result: Issue25HybridProbeResult }
  | { readonly status: 'failure'; readonly message: string };

function Issue25HybridRetrievalProbeEntry() {
  const [state, setState] = useState<ProbeState>({ status: 'running' });

  useEffect(() => {
    runIssue25HybridRetrievalProbe().then(
      result => {
        console.log('ISSUE25_HYBRID_RETRIEVAL ' + JSON.stringify(result));
        setState({ status: 'complete', result });
      },
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Issue-25 hybrid retrieval probe failed:', message);
        setState({ status: 'failure', message });
      },
    );
  }, []);

  // This one terminal selector keeps synthetic SQLCipher/FTS proof separate from the generic smoke app.
  const label =
    state.status === 'complete'
      ? `Issue 25 hybrid complete; result=${JSON.stringify(state.result)}`
      : state.status === 'failure'
        ? 'Issue 25 hybrid probe failed: ' + state.message
        : 'Issue 25 hybrid probe running';

  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={
          state.status === 'running'
            ? 'issue25-hybrid-running'
            : 'issue25-hybrid-terminal'
        }
      >
        {label}
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
  },
});

AppRegistry.registerComponent(appName, () => Issue25HybridRetrievalProbeEntry);
