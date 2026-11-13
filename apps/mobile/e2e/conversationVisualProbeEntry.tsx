import '../src/agent/polyfills';
import { useState } from 'react';
import { AppRegistry, NativeModules } from 'react-native';
import { name as appName } from '../app.json';
import { ConversationScreen } from '../src/ragConversation/ConversationScreen';
import { ConversationHistoryScreen } from '../src/ragConversation/ConversationHistoryScreen';
import { ConversationSessionsProvider } from '../src/ragConversation/ConversationSessionsContext';
import { EvidenceSourceDetailScreen } from '../src/aiFeatures/integration/EvidenceSourceDetailScreen';
import { SelectedModelControl } from '../src/layout/SelectedModelControl';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  evidenceVisualRecords,
  evidenceVisualReference,
} from './evidenceVisualFixtures';
import {
  conversationVisualSessionOptions,
  conversationVisualToolSourceSessionOptions,
  resolveConversationVisualToolSource,
  sendSyntheticConversation,
} from './conversationVisualFixture';

const settingsManager = (
  NativeModules as unknown as {
    SettingsManager?: {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    };
  }
).SettingsManager;
const launchSettings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const historySavedOutputLayoutEnabled =
  launchSettings.OROT_TEST_HISTORY_SAVED_OUTPUT_LAYOUT === 'YES';
// The provider creates its store once, so opt into retained identity before the source journey mounts.
const visualSessionOptions =
  launchSettings.OROT_TEST_CONVERSATION_TOOL_SOURCE === 'YES'
    ? conversationVisualToolSourceSessionOptions
    : conversationVisualSessionOptions;

type Route = 'conversation' | 'history' | 'evidence';
const leaveState = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  }),
};

/** Production conversation/navigation components with the synthetic retained identity limited to source navigation. */
function ConversationVisualProbe({ failure }: { readonly failure: boolean }) {
  const [controller] = useState(() =>
    createNavigationController<Route>('conversation'),
  );
  const [openedSource, setOpenedSource] = useState<EvidenceReference>(
    evidenceVisualReference,
  );
  return (
    <ConversationSessionsProvider options={visualSessionOptions}>
      <NavigationRouteAdapter
        controller={controller}
        leaveState={leaveState}
        showHome
      >
        {navigation => {
          const onBack = () => {
            navigation.onBack();
          };
          if (navigation.route.name === 'history')
            return (
              <ConversationHistoryScreen
                onBack={onBack}
                onOpenSavedAnalysis={
                  historySavedOutputLayoutEnabled
                    ? keepHistoryLayoutMounted
                    : undefined
                }
                onOpenSavedVisitQuestions={
                  historySavedOutputLayoutEnabled
                    ? keepHistoryLayoutMounted
                    : undefined
                }
              />
            );
          if (navigation.route.name === 'evidence')
            return (
              <EvidenceSourceDetailScreen
                navigationRouteKey={navigation.route.key}
                reference={openedSource}
                readSource={async () => ({
                  status: 'available',
                  document: {
                    sourceKind: 'personal_record',
                    records: [evidenceVisualRecords.medication],
                  },
                })}
                onBack={onBack}
              />
            );
          return (
            <ConversationScreen
              navigationRouteKey={navigation.route.key}
              providerSelection={
                <SelectedModelControl name="합성 UI 검사 제공자" local />
              }
              onBack={onBack}
              onOpenHistory={() => navigation.push('history')}
              onOpenSource={reference => {
                setOpenedSource(reference);
                navigation.push('evidence');
              }}
              resolveToolSource={resolveConversationVisualToolSource}
              onSend={
                failure
                  ? async () => ({ status: 'unavailable' })
                  : sendSyntheticConversation
              }
            />
          );
        }}
      </NavigationRouteAdapter>
    </ConversationSessionsProvider>
  );
}

/** This layout-only fixture has no saved-output destination; production routing is covered separately. */
function keepHistoryLayoutMounted() {
  return undefined;
}

/** Select the synthetic outcome before interaction, independent of keyboard text correction. */
export function registerConversationVisualProbe(failure: boolean) {
  AppRegistry.registerComponent(appName, () => () => (
    <ConversationVisualProbe failure={failure} />
  ));
}
