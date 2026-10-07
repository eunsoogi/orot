// LangGraph reads ReadableStream during module initialization on Hermes.
import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useMemo, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { AppointmentRepository } from '@orot/storage';
import { name as appName } from '../app.json';
import MedicalAppointmentClassificationScreen from '../src/medicalAppointments/MedicalAppointmentClassificationScreen';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import type { ProviderSelectionOption } from '../src/providers/selection/types';

// This fixture uses synthetic Calendar and provider responses without EventKit permissions or network access.
const syntheticEvent: CalendarEvent = {
  calendarEventIdentifier: 'SENTINEL_CALENDAR_EVENT_IDENTIFIER',
  effectiveAt: '2035-06-02T00:00:00.000Z',
  endsAt: '2035-06-02T01:00:00.000Z',
  calendarEventSnapshot: {
    title: 'SENTINEL_HEALTH_VALUE: synthetic blood pressure 120/80 follow-up',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};

const styles = StyleSheet.create({ root: { flex: 1 } });

function MedicalAppointmentClassificationProbeEntry() {
  const [providerCalls, setProviderCalls] = useState(0);
  const [saved, setSaved] = useState(false);
  const bridge = useMemo<CalendarBridge>(
    () => ({
      requestAccessAndListUpcomingEvents: async () => ({
        access: 'fullAccess',
        events: [syntheticEvent],
      }),
      findEvent: async () => ({ access: 'fullAccess', event: syntheticEvent }),
      addEventStoreListener: () => ({ remove: () => undefined }),
    }),
    [],
  );
  const repository = useMemo(
    () =>
      ({
        list: async () => [],
        create: async () => undefined,
        confirmCalendarEvent: async () => {
          setSaved(true);
          return undefined;
        },
        reconfirmCalendarEvent: async () => undefined,
        update: async () => undefined,
        cancel: async () => undefined,
      }) as unknown as AppointmentRepository,
    [],
  );
  const provider = useMemo<LanguageModelProvider>(
    () => ({
      kind: 'language-model',
      id: 'synthetic-classification-provider',
      displayName: 'Synthetic classification provider',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: async () => {
        setProviderCalls(current => current + 1);
        return providerFailure({
          code: 'provider_unavailable',
          message: 'Synthetic provider failure for local manual review.',
          retryable: false,
        });
      },
    }),
    [],
  );
  const selectedProvider = useMemo<ProviderSelectionOption>(
    () => ({
      provider,
      modelId: 'synthetic-model',
      displayName: 'Synthetic classification model',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
    }),
    [provider],
  );

  return (
    <View style={styles.root}>
      <Text testID="issue40-synthetic-provider-calls">
        syntheticProviderCalls={providerCalls}
      </Text>
      {saved ? (
        <Text testID="issue40-synthetic-calendar-save">
          syntheticCalendarSave=confirmed
        </Text>
      ) : null}
      <MedicalAppointmentClassificationScreen
        bridge={bridge}
        repository={repository}
        selectedProvider={selectedProvider}
        recipient="synthetic-recipient"
        onOpenManual={() => undefined}
      />
    </View>
  );
}

AppRegistry.registerComponent(
  appName,
  () => MedicalAppointmentClassificationProbeEntry,
);
