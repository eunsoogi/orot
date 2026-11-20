import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { prepareRoutesGeneratedRecords } from './routesGeneratedRecordsPreparation';
import { seedRoutesGeneratedRecords } from './routesGeneratedRecordsFixture';

const settings =
  NativeModules.SettingsManager?.settings ??
  NativeModules.SettingsManager?.getConstants?.().settings ??
  {};
// One preparation per app process; StrictMode remounts never seed a second time.
let preparation: Promise<void> | undefined;
function prepare() {
  return (preparation ??= prepareRoutesGeneratedRecords(settings, {
    nativeTestControl: Boolean(NativeModules.OrotTestControl),
    open: async () => ({
      database: await openLocalAgentMemoryDatabase(),
      records: await openLocalStorage(),
    }),
    seed: seedRoutesGeneratedRecords,
  }));
}

/** Mount the unmodified production App only after the synthetic writers commit.
 * The real appearance gate, local readers, navigation and consent remain in charge. */
export function RoutesGeneratedRecordsApp({
  prepareFixture = prepare,
}: {
  readonly prepareFixture?: () => Promise<void>;
}) {
  const [state, setState] = useState('preparing');
  useEffect(() => {
    let active = true;
    prepareFixture().then(
      () => {
        if (active) setState('ready');
      },
      () => {
        if (active) setState('failed');
      },
    );
    return () => {
      active = false;
    };
  }, [prepareFixture]);
  return state === 'ready' ? (
    <App />
  ) : (
    <Text testID="routes-generated-records-fixture-state">{state}</Text>
  );
}
AppRegistry.registerComponent(appName, () => RoutesGeneratedRecordsApp);
