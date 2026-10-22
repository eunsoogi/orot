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
import {
  evidenceVisualRecords,
  evidenceVisualReference,
} from './evidenceVisualFixtures';
import { sendSyntheticConversation } from './conversationVisualFixture';

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

/** Production conversation/session/navigation components with an explicitly synthetic sender. */
function ConversationVisualProbe() {
  const [controller] = useState(() =>
    createNavigationController<Route>('conversation'),
  );
  return (
    <ConversationSessionsProvider>
      <NavigationRouteAdapter
        controller={controller}
        leaveState={leaveState}
        showHome
      >
        {navigation => {
          const onBack = () => {
            void navigation.onBack();
          };
          if (navigation.route.name === 'history')
            return <ConversationHistoryScreen onBack={onBack} />;
          if (navigation.route.name === 'evidence')
            return (
              <EvidenceSourceDetailScreen
                navigationRouteKey={navigation.route.key}
                reference={evidenceVisualReference}
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
              onOpenSource={() => navigation.push('evidence')}
              onSend={sendSyntheticConversation}
            />
          );
        }}
      </NavigationRouteAdapter>
    </ConversationSessionsProvider>
  );
}

AppRegistry.registerComponent(appName, () => ConversationVisualProbe);
