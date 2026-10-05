import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { runStorageProbe } from '../src/storage/e2eProbe';
import type { StorageProbeMode } from '../src/storage/e2eProbe';

function getStorageProbeMode(): StorageProbeMode | null {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const value =
    settingsManager?.settings?.OROT_STORAGE_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_STORAGE_PROBE;
  if (value === 'fresh' || value === 'restart' || value === 'legacy')
    return value;
  return null;
}

function StorageProbe({ mode }: { mode: StorageProbeMode }) {
  const [result, setResult] = useState<{
    status: 'running' | 'success' | 'failure';
    message?: string;
  }>({ status: 'running' });

  useEffect(() => {
    runStorageProbe(mode).then(
      () => setResult({ status: 'success' }),
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Storage probe failed:', message);
        setResult({ status: 'failure', message });
      },
    );
  }, [mode]);

  const label = result.message
    ? 'Storage probe failure: ' + result.message
    : 'Storage probe ' + result.status;

  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={'storage-probe-' + mode + '-' + result.status}
      >
        {label}
      </Text>
    </View>
  );
}

function StorageProbeEntry() {
  const mode = getStorageProbeMode();
  return mode === null ? <App /> : <StorageProbe mode={mode} />;
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

AppRegistry.registerComponent(appName, () => StorageProbeEntry);
