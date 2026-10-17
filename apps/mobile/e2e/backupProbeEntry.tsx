import 'react-native-get-random-values';
import { useEffect, useRef, useState } from 'react';
import { AppRegistry, Pressable, StyleSheet, Text, View } from 'react-native';
import { name as appName } from '../app.json';
import {
  getBackupProbeMode,
  runBackupProbe,
  type BackupProbeResult,
} from './backupProbe';
import { backupProbeFailureReason } from './backupProbeFailure';

type ProbeState = 'idle' | 'running' | 'success' | 'failure';

function BackupProbe() {
  const mode = getBackupProbeMode();
  const [state, setState] = useState<ProbeState>(
    mode === null ? 'failure' : 'idle',
  );
  const [result, setResult] = useState<
    BackupProbeResult | { stage: string; reason?: string } | null
  >(mode === null ? { stage: 'invalid-mode' } : { stage: 'awaiting-start' });
  const active = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    // A test may terminate the app while native fixture work is still running.
    return () => {
      active.current = false;
    };
  }, []);

  const startProbe = () => {
    if (mode === null || !active.current || started.current) return;
    started.current = true;
    setState('running');
    runBackupProbe(mode).then(
      value => {
        if (!active.current) return;
        setResult(value);
        setState('success');
      },
      error => {
        if (!active.current) return;
        setState('failure');
        const reason = backupProbeFailureReason(error);
        setResult({ stage: mode, reason });
        // Only fixed categories are reported; arbitrary native errors may include private paths or device details.
        console.error('Backup probe failed at stage:', mode, reason);
      },
    );
  };

  const label = 'Backup probe ' + (mode ?? 'invalid-mode') + ' ' + state;
  const output = JSON.stringify(result);
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
      <Pressable
        accessible
        accessibilityLabel="Start backup probe"
        accessibilityRole="button"
        disabled={mode === null || state !== 'idle'}
        onPress={startProbe}
        testID="backup-probe-start"
      >
        <Text>Start backup probe</Text>
      </Pressable>
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
