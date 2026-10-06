import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import {
  runLocalE5EmbeddingProbe,
  type LocalE5ProbeMode,
  type LocalE5ProbeResult,
} from './localE5EmbeddingProbe';

type ProbeState =
  | { readonly status: 'running' }
  | { readonly status: 'complete'; readonly result: LocalE5ProbeResult }
  | { readonly status: 'failure'; readonly message: string };

function probeMode(): LocalE5ProbeMode | null {
  const settings = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const value =
    settings?.settings?.OROT_LOCAL_E5_PROBE ??
    settings?.getConstants?.().settings?.OROT_LOCAL_E5_PROBE;
  return value === 'fresh' || value === 'restart' ? value : null;
}

function LocalE5EmbeddingProbeEntry() {
  const mode = probeMode();
  const [state, setState] = useState<ProbeState>({ status: 'running' });

  useEffect(() => {
    if (!mode) {
      setState({
        status: 'failure',
        message: 'A valid probe mode was not supplied.',
      });
      return;
    }
    runLocalE5EmbeddingProbe(mode).then(
      result => {
        console.log('LOCAL_E5_EMBEDDING_PROBE ' + JSON.stringify(result));
        setState({ status: 'complete', result });
      },
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Local E5 embedding probe failed:', message);
        setState({ status: 'failure', message });
      },
    );
  }, [mode]);

  // The E2E-only entry exposes the full measurement record to Detox for capture.
  const label =
    state.status === 'complete'
      ? `Local E5 ${mode} complete; result=${JSON.stringify(state.result)}`
      : state.status === 'failure'
        ? 'Local E5 probe failed: ' + state.message
        : 'Local E5 probe running';

  // Keep one terminal selector so Detox can surface probe failures immediately.
  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={
          state.status === 'running'
            ? 'local-e5-probe-running'
            : 'local-e5-probe-terminal'
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

AppRegistry.registerComponent(appName, () => LocalE5EmbeddingProbeEntry);
