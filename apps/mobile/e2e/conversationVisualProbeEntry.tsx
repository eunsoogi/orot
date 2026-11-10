import '../src/agent/polyfills';
import { useState } from 'react';
import { AppRegistry } from 'react-native';
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
  resolveConversationVisualToolSource,
  sendSyntheticConversation,
} from './conversationVisualFixture';

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

/** Production conversation/navigation components with synthetic session identity, source, and sender. */
function ConversationVisualProbe({ failure }: { readonly failure: boolean }) {
  const [controller] = useState(() =>
    createNavigationController<Route>('conversation'),
  );
  const [openedSource, setOpenedSource] = useState<EvidenceReference>(
    evidenceVisualReference,
  );
  return (
    <ConversationSessionsProvider options={conversationVisualSessionOptions}>
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
            return <ConversationHistoryScreen onBack={onBack} />;
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

/** Select the synthetic outcome before interaction, independent of keyboard text correction. */
export function registerConversationVisualProbe(failure: boolean) {
  AppRegistry.registerComponent(appName, () => () => (
    <ConversationVisualProbe failure={failure} />
  ));
}
