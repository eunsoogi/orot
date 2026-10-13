// Hermes must install the real agent polyfills before App imports LangGraph.
import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type {
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
import { createCalendarClassificationFixtures } from './calendarClassificationFixtures';
import App from '../App';
import { name as appName } from '../app.json';

const hourMs = 60 * 60 * 1000;
const fixtureNow = Date.now();
// Classification still uses the actual selected model; only Calendar and session storage are synthetic.
const { bridge: calendarBridge, repository } =
  createCalendarClassificationFixtures(fixtureNow);
const loadAppointments = async () => repository;

const healthRecordCount = 1503;
const pageSize = 50;
function observationAt(index: number): HealthObservation {
  const effectiveAt = new Date(fixtureNow - index * hourMs).toISOString();
  return {
    id: `synthetic-health-${String(index).padStart(4, '0')}`,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: new Date(fixtureNow).toISOString(),
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: {
        system: 'healthkit',
        sourceIdentifier: 'synthetic-ui-fixture',
      },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 60 + (index % 30), unit: 'count/min' },
  };
}

/** Fixture latency exercises leaving during reads; it is not a SQL or HealthKit measurement. */
async function loadHealthObservationPage(
  cursor: HealthObservationCursor | null,
): Promise<HealthObservationPage> {
  const start = cursor
    ? Number(cursor.id.slice('synthetic-health-'.length)) + 1
    : 0;
  if (!Number.isInteger(start) || start < 0 || start > healthRecordCount) {
    throw new Error('Invalid synthetic health cursor.');
  }
  await new Promise<void>(resolve => setTimeout(resolve, cursor ? 250 : 2000));
  const records = Array.from(
    { length: Math.min(pageSize, healthRecordCount - start) },
    (_, offset) => observationAt(start + offset),
  );
  const last = records[records.length - 1];
  return {
    records,
    nextCursor:
      start + records.length < healthRecordCount && last
        ? { id: last.id, effectiveAt: last.effectiveAt }
        : null,
  };
}

/** Uses production screens, native recording, provider selection and actual Apple availability. */
function PagedRecordsProbeEntry() {
  return (
    <App
      calendarBridge={calendarBridge}
      loadAppointments={loadAppointments}
      loadHealthObservationPage={loadHealthObservationPage}
    />
  );
}

AppRegistry.registerComponent(appName, () => PagedRecordsProbeEntry);
