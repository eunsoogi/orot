import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  Button,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { runActiveTabHealthWorkload } from './activeTabHealthWorkload';
import type { CalendarBridge } from '../src/calendar/types';

const calendarBridge: CalendarBridge = {
  requestAccessAndListUpcomingEvents: async () => ({
    access: 'fullAccess',
    events: [],
  }),
  findEvent: async () => ({ access: 'fullAccess', event: null }),
  addEventStoreListener: () => ({ remove: () => undefined }),
};

function recordWorkloadEvent(event: string) {
  console.info('OROT_ACTIVE_TAB_EVENT', event, Date.now(), performance.now());
}

/** The native test entry checks for a fresh Simulator store before React starts.
 * The shared app singleton keeps the tool and actual routes on one connection. */
function ActiveTabWorkloadProbe() {
  const [state, setState] = useState('preparing');
  const [database, setDatabase] =
    useState<
      Awaited<
        ReturnType<
          typeof import('../src/storage/secureDatabase').openLocalAgentMemoryDatabase
        >
      >
    >();
  useEffect(() => {
    let active = true;
    const manager = NativeModules.SettingsManager;
    const settings =
      manager?.settings ?? manager?.getConstants?.().settings ?? {};
    if (!NativeModules.OrotTestControl || !settings.OROT_WORKLOAD_SESSION) {
      setState('unavailable');
      return;
    }
    import('../src/storage/secureDatabase')
      .then(async storage => ({
        connection: await storage.openLocalAgentMemoryDatabase(),
        appointments: await storage.openLocalAppointmentRepository(),
      }))
      .then(async ({ connection, appointments }) => {
        const now = new Date().toISOString();
        const template = JSON.stringify({
          id: 'synthetic-heart',
          effectiveAt: now,
          recordedAt: now,
          ingestedAt: now,
          provenance: {
            origin: 'imported',
            sourceRecordIds: [],
            source: {
              system: 'healthkit',
              sourceIdentifier: 'synthetic-watch',
            },
          },
          reviewState: { status: 'unreviewed' },
          observationKind: 'measurement',
          concept: 'heart_rate',
          value: { kind: 'quantity', amount: 72, unit: 'count/min' },
        });
        await connection.execute(
          `WITH RECURSIVE samples(n) AS (
             SELECT 0 UNION ALL SELECT n + 1 FROM samples WHERE n + 1 < 30000
           ), rows AS (
             SELECT n, strftime('%Y-%m-%dT%H:%M:%fZ', ?, printf('-%d seconds', n * 30)) AS at
             FROM samples
           )
           INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json)
           SELECT 'synthetic-heart-' || n, at, at, ?,
             json_set(?, '$.id', 'synthetic-heart-' || n, '$.effectiveAt', at, '$.recordedAt', at)
           FROM rows`,
          [now, now, template],
        );
        for (let index = 0; index < 20; index++) {
          await appointments.create({
            effectiveAt: new Date(
              Date.now() + (index + 1) * 86400000,
            ).toISOString(),
            clinicLabel: `Synthetic clinic ${index + 1}`,
          });
        }
        if (active) {
          setDatabase(connection);
          setState('ready');
        }
      })
      .catch(() => active && setState('failed'));
    return () => {
      active = false;
    };
  }, []);
  if (!database) return <Text testID="active-tab-workload-state">{state}</Text>;
  const start = () => {
    const end = new Date();
    setState('running');
    recordWorkloadEvent('tool-requested');
    runActiveTabHealthWorkload(
      database,
      {
        fromInclusive: new Date(end.getTime() - 15 * 86400000).toISOString(),
        toExclusive: end.toISOString(),
        timeZone: 'UTC',
      },
      new AbortController().signal,
      recordWorkloadEvent,
    )
      .then(count => setState(count === 30000 ? 'finished' : 'failed'))
      .catch(() => setState('failed'))
      .finally(() => recordWorkloadEvent('tool-settled'));
  };
  return (
    <View style={styles.fill}>
      <View>
        <Button
          title="Start synthetic workload"
          testID="active-tab-workload-start"
          onPress={start}
          disabled={state === 'running'}
        />
        <Text testID="active-tab-workload-state">{state}</Text>
      </View>
      <View style={styles.fill}>
        <App calendarBridge={calendarBridge} />
      </View>
    </View>
  );
}

AppRegistry.registerComponent(appName, () => ActiveTabWorkloadProbe);

const styles = StyleSheet.create({ fill: { flex: 1 } });
