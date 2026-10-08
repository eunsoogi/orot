import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { name as appName } from '../app.json';
import {
  getBackupProbeMode,
  runBackupProbe,
  type BackupProbeResult,
} from './backupProbe';

type ProbeState = 'running' | 'success' | 'failure';

function BackupProbe() {
  const mode = getBackupProbeMode();
  const [state, setState] = useState<ProbeState>('running');
  const [result, setResult] = useState<
    BackupProbeResult | { stage: string } | null
  >(null);

  useEffect(() => {
    let active = true;
    if (mode === null) {
      setState('failure');
      setResult({ stage: 'invalid-mode' });
      return () => {
        active = false;
      };
    }
    runBackupProbe(mode).then(
      value => {
        if (!active) return;
        setResult(value);
        setState('success');
      },
      () => {
        if (!active) return;
        setState('failure');
        setResult({ stage: mode });
        // Keep diagnostics to a fixed stage; native errors can include paths or device details.
        console.error('Backup probe failed at stage:', mode);
      },
    );
    return () => {
      active = false;
    };
  }, [mode]);

  const label = 'Backup probe ' + (mode ?? 'invalid-mode') + ' ' + state;
  const output = JSON.stringify(result ?? { stage: 'starting' });
  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={'backup-probe-' + (mode ?? 'invalid') + '-' + state}
      >
        {label}
      </Text>
      <Text accessibilityLabel={output} testID="backup-probe-result">
        {output}
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

AppRegistry.registerComponent(appName, () => BackupProbe);
