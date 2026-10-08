import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text, View } from 'react-native';
import { name as appName } from '../app.json';
import type { RecordRepository } from '@orot/storage';
import {
  openLocalAppointmentRepository,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { healthKit } from '../src/healthkit';
import { healthKitFeatures } from '../src/healthkit/types';
import { createUnifiedImportCoordinator } from '../src/healthkit/unifiedImport/coordinator';
import { HealthKitImportScreen } from '../src/healthkit/unifiedImport/HealthKitImportScreen';
import { createUnifiedFeatureImporter } from '../src/healthkit/unifiedImport/featureImporter';
import { summarizeUnifiedImportMeasurements } from './unifiedImportProbeMeasurements';
import { unifiedImportProbeCopy } from './unifiedImportProbeCopy';
import type { UnifiedImportMeasurement } from '../src/healthkit/unifiedImport/types';
import { unifiedHealthImportCoordinator } from '../src/healthkit/unifiedImport/localImport';
import type { CalendarEvent } from '../src/calendar/types';

// Fixture-backed mode still invokes HealthKit; cancellable mode uses in-memory adapters.
// API completion timings do not measure the visibility of either system sheet.

interface SimulatorFixtureModule {
  prepareSyntheticFixtures(
    features: readonly string[],
  ): Promise<{ mode: string }>;
  removeSyntheticFixture(): Promise<void>;
}

const syntheticCalendarEvent: CalendarEvent = {
  calendarEventIdentifier: 'synthetic-calendar-event',
  effectiveAt: '2035-06-02T00:00:00.000Z',
  endsAt: '2035-06-02T01:00:00.000Z',
  calendarEventSnapshot: {
    title: 'Synthetic appointment candidate',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};

const fixtureModule = NativeModules.HealthKitModule as
  SimulatorFixtureModule | undefined;

const syntheticCoordinator = createUnifiedImportCoordinator({
  healthKit: {
    requestReadAuthorizations: features =>
      healthKit.requestReadAuthorizations(features),
  },
  eventKit: {
    async requestEventAccess() {
      return 'fullAccess';
    },
    async listUpcomingEvents() {
      return { access: 'fullAccess', events: [syntheticCalendarEvent] };
    },
  },
  openRepository: openLocalStorage,
  async confirmCalendarEvent(event) {
    const repository = await openLocalAppointmentRepository();
    await repository.confirmCalendarEvent(event);
  },
  runFeature: createUnifiedFeatureImporter({
    healthKit,
    now: () => new Date().toISOString(),
  }),
});

const cancellableProbeRuntime = {
  holdNextStoragePreparation: true,
  releaseStoragePreparation: null as (() => void) | null,
  featureRuns: 0,
  syntheticRecords: new Set<string>(),
};

const cancellableBaseCoordinator = createUnifiedImportCoordinator({
  // This mode keeps cancellation coverage independent of HealthKit grants and records.
  healthKit: {
    async requestReadAuthorizations(features) {
      return {
        availability: 'available',
        requestStatus: 'completed',
        readAuthorization: 'notObservable',
        requestedFeatures: features,
        unsupportedFeatures: [],
      };
    },
  },
  eventKit: {
    async requestEventAccess() {
      return 'fullAccess';
    },
    async listUpcomingEvents() {
      return { access: 'fullAccess', events: [] };
    },
  },
  async openRepository() {
    if (cancellableProbeRuntime.holdNextStoragePreparation) {
      cancellableProbeRuntime.holdNextStoragePreparation = false;
      // Gate before feature queries so cancellation can prove that no write starts.
      await new Promise<void>(resolve => {
        cancellableProbeRuntime.releaseStoragePreparation = resolve;
      });
    }
    return {} as RecordRepository;
  },
  async confirmCalendarEvent() {},
  async runFeature(feature, _authorization, _repository, instrumentation) {
    cancellableProbeRuntime.featureRuns += 1;
    await instrumentation.query(async () => undefined);
    await instrumentation.persist(async () => {
      // A feature marker proves retry progress without writing a record or value.
      cancellableProbeRuntime.syntheticRecords.add(feature);
    });
    return { status: 'complete', importedCount: 1, deletedCount: 0 };
  },
});

const cancellableCoordinator: ReturnType<
  typeof createUnifiedImportCoordinator
> = {
  start(selection, listeners) {
    const run = cancellableBaseCoordinator.start(selection, listeners);
    return {
      ...run,
      cancel() {
        run.cancel();
        releaseCancellableStoragePreparation();
      },
    };
  },
};

function probeMode(): 'live' | 'synthetic' | 'cancellable' {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const value =
    settingsManager?.settings?.OROT_UNIFIED_IMPORT_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_UNIFIED_IMPORT_PROBE;
  if (value === 'live') return 'live';
  return value === 'cancellable' ? 'cancellable' : 'synthetic';
}

function releaseCancellableStoragePreparation() {
  const release = cancellableProbeRuntime.releaseStoragePreparation;
  cancellableProbeRuntime.releaseStoragePreparation = null;
  release?.();
}

function summarizeCancellableProbe(
  measurements: readonly UnifiedImportMeasurement[],
): string {
  const countStarted = (
    provider: UnifiedImportMeasurement['provider'],
    phase: UnifiedImportMeasurement['phase'],
  ) =>
    measurements.filter(
      measurement =>
        measurement.provider === provider &&
        measurement.phase === phase &&
        measurement.transition === 'started',
    ).length;

  return [
    `fakeFeatureRuns=${cancellableProbeRuntime.featureRuns}`,
    `queryOperations=${countStarted('healthKit', 'query')}`,
    `persistenceOperations=${countStarted('localStore', 'persistence')}`,
    `syntheticStoredRecords=${cancellableProbeRuntime.syntheticRecords.size}`,
  ].join(';');
}

function UnifiedImportProbe() {
  const mode = probeMode();
  const [ready, setReady] = useState(mode !== 'synthetic');
  const [error, setError] = useState(false);
  const [measurements, setMeasurements] = useState<UnifiedImportMeasurement[]>(
    [],
  );

  useEffect(() => {
    if (mode !== 'synthetic') return undefined;
    if (!fixtureModule) {
      setError(true);
      return undefined;
    }
    let active = true;
    fixtureModule
      .prepareSyntheticFixtures(healthKitFeatures)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      fixtureModule?.removeSyntheticFixture().catch(() => undefined);
    };
  }, [mode]);

  if (!ready) {
    return (
      <View>
        <Text testID="unified-import-probe-status">
          {error ? 'probe=failed' : `probe=preparing;source=${mode}`}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <HealthKitImportScreen
        coordinator={
          mode === 'live'
            ? unifiedHealthImportCoordinator
            : mode === 'cancellable'
              ? cancellableCoordinator
              : syntheticCoordinator
        }
        copy={unifiedImportProbeCopy}
        onMeasurement={measurement =>
          setMeasurements(current => [...current, measurement])
        }
      />
      <Text testID="unified-import-probe-status">
        {`probe=ready;source=${mode};systemSheets=${mode === 'live' ? 'not-captured' : 'not-observed'}`}
      </Text>
      <Text testID="unified-import-probe-measurements">
        {summarizeUnifiedImportMeasurements(measurements)}
      </Text>
      {mode === 'cancellable' ? (
        <Text testID="unified-import-probe-cancellation-summary">
          {summarizeCancellableProbe(measurements)}
        </Text>
      ) : null}
    </View>
  );
}

AppRegistry.registerComponent(appName, () => UnifiedImportProbe);
