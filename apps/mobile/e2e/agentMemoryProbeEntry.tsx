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
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import type { AgentMemoryProbeMode } from '../src/memory/agentMemoryProbe';

function getProbeMode(): AgentMemoryProbeMode | null {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const value =
    settingsManager?.settings?.OROT_AGENT_MEMORY_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_AGENT_MEMORY_PROBE;
  return value === 'fresh' || value === 'restart' || value === 'verify-deletion'
    ? value
    : null;
}

function AgentMemoryProbe() {
  const mode = getProbeMode();
  const settingsManager = NativeModules.SettingsManager;
  const fixtureIdentifier =
    settingsManager?.settings?.OROT_TEST_MEMORY_FIXTURE ??
    settingsManager?.getConstants?.().settings?.OROT_TEST_MEMORY_FIXTURE;
  const [status, setStatus] = useState<'running' | 'success' | 'failure'>(
    'running',
  );
  const [failureDetail, setFailureDetail] = useState('');

  useEffect(() => {
    if (!mode) {
      setStatus('failure');
      return;
    }
    runAgentMemoryProbe(
      mode,
      typeof fixtureIdentifier === 'string' ? fixtureIdentifier : undefined,
    ).then(
      () => setStatus('success'),
      error => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Agent memory probe failed:', message);
        setFailureDetail(message);
        setStatus('failure');
      },
    );
  }, [mode, fixtureIdentifier]);

  const label =
    'Agent memory probe ' +
    status +
    (failureDetail ? ': ' + failureDetail : '');
  return (
    <View style={styles.container}>
      <Text
        accessible
        accessibilityLabel={label}
        testID={'agent-memory-probe-' + status}
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

AppRegistry.registerComponent(appName, () => AgentMemoryProbe);
