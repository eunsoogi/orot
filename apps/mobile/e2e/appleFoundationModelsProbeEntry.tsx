import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { name as appName } from '../app.json';
import {
  runAppleFoundationModelsProbe,
  type AppleFoundationModelsProbeResult,
} from './appleFoundationModelsProbe';

type ProbeState =
  | { readonly status: 'running' }
  | { readonly status: 'complete'; readonly result: AppleFoundationModelsProbeResult }
  | { readonly status: 'failure'; readonly message: string };

function AppleFoundationModelsProbeEntry() {
  const [state, setState] = useState<ProbeState>({ status: 'running' });

  useEffect(() => {
    runAppleFoundationModelsProbe().then(
      result => {
        console.log('APPLE_FOUNDATION_MODELS_PROBE ' + JSON.stringify(result));
        setState({ status: 'complete', result });
      },
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Apple Foundation Models probe failed:', message);
        setState({ status: 'failure', message });
      },
    );
  }, []);

  const label = state.status === 'complete'
    ? 'Apple Foundation Models probe complete; availability=' + state.result.availability
      + '; generation=' + state.result.generation
      + '; sourceIdPreserved=' + state.result.sourceIdPreserved
      + '; cancellation=' + state.result.cancellation
      + '; inferenceStop=' + state.result.inferenceStop
    : state.status === 'failure'
      ? 'Apple Foundation Models probe failed: ' + state.message
      : 'Apple Foundation Models probe running';

  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={'apple-foundation-models-probe-' + state.status}
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
    backgroundColor: '#f7f8fa',
  },
});

AppRegistry.registerComponent(appName, () => AppleFoundationModelsProbeEntry);
