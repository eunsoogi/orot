import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text, View } from 'react-native';
import { name as appName } from '../app.json';
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

// Synthetic mode substitutes provider services; live mode invokes both native consent APIs.
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

function probeMode(): 'live' | 'synthetic' {
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
  return value === 'live' ? 'live' : 'synthetic';
}

function UnifiedImportProbe() {
  const mode = probeMode();
  const [ready, setReady] = useState(mode === 'live');
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
    </View>
  );
}

AppRegistry.registerComponent(appName, () => UnifiedImportProbe);
