import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AppRegistry,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import { DailyReportRoute } from '../src/aiFeatures/integration/DailyReportRoute';
import type { createDailyReportFeature } from '../src/aiFeatures/integration/dailyReportFeature';
import type { ConversationEntryContext } from '../src/aiFeatures/integration/conversationIntent';
import { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../src/ragConversation/ConversationSessionsContext';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { SelectedModelControl } from '../src/layout/SelectedModelControl';
import { feature, identity, target } from './dailyReportVisualFixture';
import { useControlledDailyReportPreview } from './useControlledDailyReportPreview';

type Route = 'report' | 'conversation';
const leaveState = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  }),
};

/** Mount the production report and conversation with explicit synthetic entry data. */
export function DailyReportVisualProbe({
  reportFeature = feature,
  reportRevision = target.revision,
  initialRoute = 'report',
  reportControls,
}: {
  reportFeature?: ReturnType<typeof createDailyReportFeature>;
  reportRevision?: number;
  initialRoute?: Route;
  reportControls?: ReactNode;
} = {}) {
  const [controller] = useState(() =>
    createNavigationController<Route>(initialRoute),
  );
  const [selected, setSelected] =
    useState<ConversationEntryContext['dailyReport']>();
  return (
    <ConversationSessionsProvider>
      <NavigationRouteAdapter
        controller={controller}
        leaveState={leaveState}
        showHome
        rootTabs={{ activeTab: 'ai', onSelect: () => {} }}
      >
        {navigation =>
          navigation.route.name === 'report' ? (
            <DailyReportRoute
              feature={reportFeature}
              initialIdentity={identity}
              navigationRouteKey={navigation.route.key}
              providerSelection={
                <>
                  <SelectedModelControl name="합성 검사 모델" local />
                  {reportControls}
                </>
              }
              onBack={navigation.onBack}
              onChat={value => {
                setSelected(value);
                navigation.push('conversation');
              }}
            />
          ) : (
            <ConversationScreen
              navigationRouteKey={navigation.route.key}
              entryContext={
                selected
                  ? {
                      intent: 'conversation',
                      entryKey: 'synthetic-report-entry',
                      dailyReport: selected,
                    }
                  : undefined
              }
              providerSelection={
                <SelectedModelControl name="합성 검사 모델" local />
              }
              onBack={navigation.onBack}
              onOpenDailyReport={() => navigation.push('report')}
              onOpenSource={() => {}}
              onSend={async (_question, _history, signal, _observer, entry) => {
                if (
                  signal?.aborted ||
                  entry?.dailyReport?.identity.key !== identity.key ||
                  entry.dailyReport.runId !== target.runId ||
                  entry.dailyReport.revision !== reportRevision
                )
                  return { status: 'failure', kind: 'stale_evidence' };
                return {
                  status: 'answer',
                  answer: '합성 보고서 대화 연결을 확인했어요.',
                  citations: [],
                };
              }}
            />
          )
        }
      </NavigationRouteAdapter>
    </ConversationSessionsProvider>
  );
}

/** Reuses the visual fixture with an explicitly held preview and native controls. */
export function DailyReportLoadingProbe() {
  const { reportFeature, controls } = useControlledDailyReportPreview();
  return (
    <DailyReportVisualProbe
      reportFeature={reportFeature}
      reportControls={controls}
    />
  );
}

/** Persistence mode uses a real encrypted report and never seeds during readback. */
function DailyReportPersistenceProbe({ mode }: { mode: 'seed' | 'read' }) {
  const [state, setState] =
    useState<
      Awaited<
        ReturnType<
          typeof import('./dailyReportPersistenceFixture').openDailyReportPersistence
        >
      >
    >();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    import('./dailyReportPersistenceFixture')
      .then(module => module.openDailyReportPersistence(mode))
      .then(
        result => {
          if (active) setState(result);
        },
        () => {
          if (active) setFailed(true);
        },
      );
    return () => {
      active = false;
    };
  }, [mode]);
  if (!state)
    return (
      <Text
        testID={
          failed
            ? 'daily-report-persistence-failure'
            : 'daily-report-persistence-loading'
        }
      >
        {failed
          ? 'Synthetic report storage failed'
          : 'Preparing synthetic encrypted report'}
      </Text>
    );
  const storedFeature: ReturnType<typeof createDailyReportFeature> = {
    ...feature,
    lookup: state.store.lookup,
  };
  return (
    <View style={styles.container}>
      <DailyReportVisualProbe
        reportFeature={storedFeature}
        reportRevision={state.saved.revision}
        initialRoute={mode === 'read' ? 'conversation' : 'report'}
      />
      <View pointerEvents="none" style={styles.marker}>
        <Text
          testID="daily-report-persistence-process"
          accessibilityLabel={state.processInstance}
          style={styles.markerText}
        >
          {state.processInstance}
        </Text>
        <Text
          testID="daily-report-persistence-snapshot"
          accessibilityLabel={JSON.stringify(state.saved)}
          style={styles.markerText}
        >
          {JSON.stringify(state.saved)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  marker: { position: 'absolute', left: 0, top: 0 },
  markerText: { fontSize: 1 },
});

function DailyReportVisualEntry() {
  const settings =
    NativeModules.SettingsManager?.settings ??
    NativeModules.SettingsManager?.getConstants?.().settings ??
    {};
  const mode = settings.OROT_DAILY_REPORT_PERSISTENCE;
  return mode === 'seed' || mode === 'read' ? (
    <DailyReportPersistenceProbe mode={mode} />
  ) : (
    <DailyReportVisualProbe />
  );
}

AppRegistry.registerComponent(appName, () => DailyReportVisualEntry);
