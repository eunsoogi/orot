import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useState } from 'react';
import { AppRegistry } from 'react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { name as appName } from '../app.json';
import { DailyReportRoute } from '../src/aiFeatures/integration/DailyReportRoute';
import type { createDailyReportFeature } from '../src/aiFeatures/integration/dailyReportFeature';
import type { ConversationEntryContext } from '../src/aiFeatures/integration/conversationIntent';
import { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../src/ragConversation/ConversationSessionsContext';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { SelectedModelControl } from '../src/layout/SelectedModelControl';

const identity = createDailyReportIdentity('2035-01-01', 'Asia/Seoul');
const target = { identity, runId: 'synthetic-report', revision: 2 };
const saved = {
  status: 'saved' as const,
  ...target,
  context: { identity, generationCutoff: '2035-01-01T03:00:00Z' },
  report: {
    generatedAt: '2035-01-01T03:01:00Z',
    observations: [{ text: '합성 심박수 기록은 72회예요.' }],
    coverage: [
      {
        source: 'health_observation',
        status: 'partial',
        limitationCodes: ['partial_day'],
      },
    ],
  },
};

// This in-memory visual fixture never reads or writes a saved report or invokes AI.
const feature = {
  lookup: async (requested: typeof identity) =>
    requested.key === identity.key ? saved : { status: 'missing' as const },
  preview: async () => ({ status: 'not_today' as const }),
  retain: () => () => {},
  active: () => null,
  start: () => {
    throw new Error('The visual fixture must not generate.');
  },
} as unknown as ReturnType<typeof createDailyReportFeature>;

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
export function DailyReportVisualProbe() {
  const [controller] = useState(() =>
    createNavigationController<Route>('report'),
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
              feature={feature}
              initialIdentity={identity}
              navigationRouteKey={navigation.route.key}
              providerSelection={
                <SelectedModelControl name="합성 검사 모델" local />
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
              onOpenSource={() => {}}
              onSend={async (_question, _history, signal, _observer, entry) => {
                if (
                  signal?.aborted ||
                  entry?.dailyReport?.identity.key !== identity.key ||
                  entry.dailyReport.runId !== target.runId ||
                  entry.dailyReport.revision !== target.revision
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

AppRegistry.registerComponent(appName, () => DailyReportVisualProbe);
