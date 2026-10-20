import '../src/agent/polyfills';
import { useMemo, useState } from 'react';
import { AppRegistry, View } from 'react-native';
import { name as appName } from '../app.json';
import { AppButton } from '../src/layout/AppButton';
import { EvidenceSourceDetailScreen } from '../src/aiFeatures/integration/EvidenceSourceDetailScreen';
import type { EvidenceSourceReadResult } from '../src/aiFeatures/integration/evidenceRegistry';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import {
  evidenceVisualRecords,
  evidenceVisualReference,
  evidenceVisualMedication,
} from './evidenceVisualFixtures';
import { evidenceVisualPeriod } from './evidenceVisualPeriod';

const modes = [
  'medication',
  'measurement',
  'activity',
  'sleep',
  'period',
  'loading',
  'missing',
  'changed',
  'unavailable',
] as const;
type Mode = (typeof modes)[number];
type Route = 'picker' | Mode;
const leaveState = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  }),
};

/** Native navigation and the production detail renderer; only the source read is synthetic. */
function EvidenceVisualProbe() {
  const [controller] = useState(() =>
    createNavigationController<Route>('picker'),
  );
  return (
    <NavigationRouteAdapter
      controller={controller}
      leaveState={leaveState}
      showHome
    >
      {navigation =>
        navigation.route.name === 'picker' ? (
          <View style={{ padding: 24, gap: 8 }} testID="evidence-visual-picker">
            {modes.map(mode => (
              <AppButton
                key={mode}
                title={mode}
                testID={`evidence-visual-${mode}`}
                onPress={() => navigation.push(mode)}
              />
            ))}
          </View>
        ) : (
          <Detail
            key={navigation.route.key}
            mode={navigation.route.name}
            routeKey={navigation.route.key}
            onBack={() => {
              void navigation.onBack();
            }}
          />
        )
      }
    </NavigationRouteAdapter>
  );
}

function Detail({
  mode,
  routeKey,
  onBack,
}: {
  mode: Mode;
  routeKey: string;
  onBack: () => void;
}) {
  const readSource = useMemo(() => {
    let attempts = 0;
    return async (
      _reference: typeof evidenceVisualReference,
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> => {
      attempts += 1;
      if (mode === 'loading') {
        // A pending local read remains cancellable without any arbitrary timed delay.
        return new Promise(resolve =>
          signal.addEventListener(
            'abort',
            () => resolve({ status: 'unavailable' }),
            { once: true },
          ),
        );
      }
      if (mode === 'missing' || mode === 'changed') return { status: mode };
      if (mode === 'period')
        return { status: 'available', document: evidenceVisualPeriod };
      if (mode === 'unavailable' && attempts === 1)
        return { status: 'unavailable' };
      return {
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [
            evidenceVisualRecords[
              mode === 'unavailable' ? 'measurement' : mode
            ],
            ...(mode === 'medication' ? [evidenceVisualMedication] : []),
          ],
        },
      };
    };
  }, [mode]);
  return (
    <EvidenceSourceDetailScreen
      navigationRouteKey={routeKey}
      reference={
        mode === 'period'
          ? {
              ...evidenceVisualReference,
              locator: evidenceVisualPeriod.scope,
              effectiveTime: null,
            }
          : evidenceVisualReference
      }
      readSource={readSource}
      onBack={onBack}
    />
  );
}

AppRegistry.registerComponent(appName, () => EvidenceVisualProbe);
