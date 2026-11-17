import { useCallback, useEffect, useRef, useState } from 'react';
import { AppRegistry, NativeModules, Text } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { SavedMemoryLoaderContext } from '../src/memory/SavedMemoryLoaderContext';
import { loadUnifiedLocalMemories } from '../src/memory/unifiedSavedMemories';
import { seedMemoryHistory } from './memoryHistorySeed';
const manager = NativeModules.SettingsManager;
const settings = manager?.settings ?? manager?.getConstants?.().settings ?? {};

/** Real App navigation and encrypted originals, with no new manual-input UI or provider calls. */
function MemoryHistoryEntry() {
  const [state, setState] = useState('loading');
  const attempts = useRef(0);
  useEffect(() => {
    seedMemoryHistory(settings.OROT_TEST_MEMORY_SEED).then(
      () => setState('ready'),
      () => setState('failed'),
    );
  }, []);
  const load = useCallback(async () => {
    attempts.current += 1;
    if (
      settings.OROT_TEST_SCENARIO === 'manual-history-recovery' &&
      attempts.current === 1
    )
      throw new Error('Synthetic test-only memory-read failure.');
    return loadUnifiedLocalMemories();
  }, []);
  if (state !== 'ready')
    return <Text testID="memory-fixture-state">{state}</Text>;
  // This injected reader retains normal privacy guards but does not schedule projection maintenance.
  return (
    <SavedMemoryLoaderContext.Provider value={load}>
      <App />
    </SavedMemoryLoaderContext.Provider>
  );
}
AppRegistry.registerComponent(appName, () => MemoryHistoryEntry);
