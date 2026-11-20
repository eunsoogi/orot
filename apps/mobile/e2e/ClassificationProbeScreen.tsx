import { useEffect, useMemo, useState } from 'react';
import { useClassificationLayoutReceipt } from './classificationLayoutReceipt';
import { ClassificationConsentSettings } from './ClassificationConsentSettings';
import { ClassificationReaderSceneControl } from './ClassificationReaderSceneControl';
import type { createSettingsConsentUiServices } from './settingsConsentUiServices';
import { NativeModules, Pressable, StyleSheet, Text, View } from 'react-native';
import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { AppointmentRepository } from '@orot/storage';
import {
  classificationStageEvents,
  createClassificationStageScenario,
} from './classificationStageScenario';
import { ClassificationReaderObservationContext } from '../src/medicalAppointments/ClassificationReaderFrame';
import MedicalAppointmentClassificationScreen from '../src/medicalAppointments/MedicalAppointmentClassificationScreen';
import type { CalendarAutoSyncState } from '../src/calendar/calendarAutoSync';
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

const settings = NativeModules?.SettingsManager;
const launch = settings?.settings ?? settings?.getConstants?.().settings ?? {};
const defaultStaged = launch.OROT_TEST_CLASSIFICATION_STAGES === 'YES';
const defaultWideStage =
  launch.OROT_TEST_CLASSIFICATION_STAGE_SCENE === 'YES' &&
  typeof launch.OROT_TEST_ROTATION_GEOMETRY_SESSION === 'string';

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Synthetic control only: 1pt headroom avoids AX Float32 underflow at the strict 44pt oracle.
  // This reserves 1pt more fixture space; product viewport ownership and minimum targets are unchanged.
  gate: { minHeight: 45, justifyContent: 'center' },
  witness: {
    position: 'absolute',
    width: 1,
    height: 1,
    fontSize: 1,
    bottom: 0,
    right: 0,
  },
});

export function ClassificationProbeScreen({
  input,
  staged = defaultStaged,
}: {
  input: ReturnType<typeof createSettingsConsentUiServices>;
  staged?: boolean;
}) {
  const layout = useClassificationLayoutReceipt(staged);
  const events = useMemo(
    () => (staged ? classificationStageEvents() : [syntheticEvent]),
    [staged],
  );
  const [showSettings, setShowSettings] = useState(false);
  const [scenePreparationEnded, setScenePreparationEnded] = useState(false);
  const [waiting, setWaiting] = useState<'model' | 'save' | null>(null);
  const scenario = useMemo(
    () => createClassificationStageScenario(setWaiting),
    [],
  );
  useEffect(() => {
    scenario.activate();
    return () => scenario.dispose();
  }, [scenario]);
  const [providerCalls, setProviderCalls] = useState(0);
  const [saved, setSaved] = useState(false);
  const [payloadPrivacy, setPayloadPrivacy] = useState('not-sent');
  const bridge = useMemo<CalendarBridge>(
    () => ({
      requestAccessAndListUpcomingEvents: async () => ({
        access: 'fullAccess',
        events: [...events],
      }),
      findEvent: async identifier => ({
        access: 'fullAccess',
        event:
          events.find(value => value.calendarEventIdentifier === identifier) ??
          null,
      }),
      addEventStoreListener: () => ({ remove: () => undefined }),
    }),
    [events],
  );
  const calendarSync = useMemo<CalendarAutoSyncState>(
    () => ({
      access: 'fullAccess',
      events,
      query: {
        fromInclusive: '2035-01-01T00:00:00.000Z',
        toExclusive: '2036-01-01T00:00:00.000Z',
        horizonYears: 1,
        resultLimit: null,
        complete: true,
        omittedEventCount: 0,
      },
      loading: false,
      error: false,
      updatedAt: '2035-01-01T00:00:00.000Z',
    }),
    [events],
  );
  const repository = useMemo(
    () =>
      ({
        list: async () => [],
        create: async () => undefined,
        confirmCalendarEvent: async () => {
          if (staged) await scenario.waitForSave();
          setSaved(true);
          return undefined;
        },
        reconfirmCalendarEvent: async () => undefined,
        update: async () => undefined,
        cancel: async () => undefined,
      }) as unknown as AppointmentRepository,
    [scenario, staged],
  );
  const provider = useMemo<LanguageModelProvider>(
    () => ({
      kind: 'language-model',
      id: 'openai-api-decisions',
      displayName: 'Synthetic classification provider',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: async (request, options) => {
        setProviderCalls(current => current + 1);
        const payload = JSON.stringify(request);
        setPayloadPrivacy(
          `syntheticHealthIncluded=${payload.includes('SENTINEL_HEALTH_VALUE')};syntheticIdentifierExcluded=${!payload.includes('SENTINEL_CALENDAR_EVENT_IDENTIFIER')}`,
        );
        if (staged) return scenario.generate(request, options);
        return providerFailure({
          code: 'provider_unavailable',
          message: 'Synthetic provider failure for local manual review.',
          retryable: false,
        });
      },
    }),
    [scenario, staged],
  );
  const selectedProvider = useMemo<ProviderSelectionOption>(
    () => ({
      provider,
      modelId: 'gpt-6-luna',
      displayName: 'Synthetic classification model',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
    }),
    [provider],
  );

  const witness = `syntheticProviderCalls=${providerCalls};syntheticRelease=${waiting ?? 'idle'}`;
  const readerObservation =
    staged && launch.OROT_TEST_CLASSIFICATION_LAYOUT === 'YES' ? (
      <Text
        accessible
        pointerEvents="none"
        style={styles.witness}
        testID="classification-reader-start-witness"
        accessibilityLabel={witness}
      >
        {witness}
      </Text>
    ) : null;

  if (showSettings)
    return (
      <ClassificationConsentSettings
        input={input}
        onClose={() => setShowSettings(false)}
      />
    );
  return (
    <View style={styles.root}>
      {layout.marker}
      <Text
        testID="calendar-classification-synthetic-provider-calls"
        onPress={layout.request}
      >
        syntheticProviderCalls={providerCalls}
      </Text>
      <Text testID="classification-synthetic-payload-privacy">
        {payloadPrivacy}
      </Text>
      {saved ? (
        <Text testID="calendar-classification-synthetic-calendar-save">
          syntheticCalendarSave=confirmed
        </Text>
      ) : null}
      {/* Reuse the idle fixture gate's slot until Settings opens. */}
      {staged && defaultWideStage && !scenePreparationEnded ? (
        <ClassificationReaderSceneControl />
      ) : staged ? (
        <Pressable
          testID="classification-release-response"
          accessibilityRole="button"
          accessibilityLabel={`Release synthetic ${waiting ?? 'idle'}`}
          disabled={!waiting}
          accessibilityState={{ disabled: !waiting }}
          onPress={scenario.release}
          style={styles.gate}
        >
          <Text>{`Synthetic gate: ${waiting ?? 'idle'}`}</Text>
        </Pressable>
      ) : null}
      <ClassificationReaderObservationContext.Provider
        value={readerObservation}
      >
        <MedicalAppointmentClassificationScreen
          bridge={bridge}
          calendarSync={calendarSync}
          repository={repository}
          selectedProvider={selectedProvider}
          recipient="OpenAI API"
          onOpenProviderSelection={() => {
            if (staged && defaultWideStage) setScenePreparationEnded(true);
            setShowSettings(true);
          }}
        />
      </ClassificationReaderObservationContext.Provider>
    </View>
  );
}
