import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Button } from 'react-native';
import type { AlertButton } from 'react-native';
import * as inferenceConsent from '../../agent/execution/useInferenceConsent';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationLeaveState } from '../../navigation/navigationLeaveGuard';
import { useAiFeatureRouteLeaveState } from '../../aiFeatures/integration/useAiFeatureNavigationState';
import type { AiFeatureRouteName } from '../../aiFeatures/integration/aiFeatureNavigation';
import { navigationText } from '../../i18n/navigation';
import { publications } from '../testSupport/literatureLayoutFixtures';
import type {
  EuropePmcMedicalEvidenceService,
  EuropePmcSearchResult,
} from '../europePmc';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

// The removed product entry is mounted only here to preserve its guarded leave behavior.
function RetainedSearch({
  navigation,
  search,
}: {
  navigation: NavigationRouteActions<AiFeatureRouteName>;
  search: EuropePmcMedicalEvidenceService['search'];
}) {
  const states = useRef(new Map<string, NavigationLeaveState>());
  const service = useMemo(() => ({ search }), [search]);
  useAiFeatureRouteLeaveState(navigation, states);
  const report = useCallback(
    (key: string, state: NavigationLeaveState | null) => {
      if (state) states.current.set(key, state);
      else states.current.delete(key);
    },
    [],
  );
  return (
    <ExternalMedicalEvidenceScreen
      navigationRouteKey={navigation.route.key}
      onNavigationStateChange={report}
      onBack={() => {
        navigation.onBack().then(
          () => undefined,
          () => undefined,
        );
      }}
      onOpenArticle={jest.fn()}
      service={service}
    />
  );
}

function RetainedSearchHarness({
  search,
}: {
  search: EuropePmcMedicalEvidenceService['search'];
}) {
  const [controller] = useState(() =>
    createNavigationController<AiFeatureRouteName>('app-home'),
  );
  return (
    <NavigationRouteAdapter
      controller={controller}
      showHome
      leaveState={{
        readState: () => ({
          hasUnsavedChanges: false,
          isRecording: false,
          hasOngoingOperation: false,
          revision: 0,
          inputRevision: 0,
        }),
      }}
    >
      {navigation =>
        navigation.route.name === 'app-home' ? (
          <Button
            testID="open-retained-search"
            title="Open search"
            onPress={() => navigation.push('external-evidence')}
          />
        ) : (
          <RetainedSearch navigation={navigation} search={search} />
        )
      }
    </NavigationRouteAdapter>
  );
}

test('confirmed route removal aborts the request and a late result cannot populate a new visit', async () => {
  jest.spyOn(inferenceConsent, 'useInferenceConsent').mockReturnValue({
    consent: { authorize: async () => 'authorized' },
    disclosureSheet: null,
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let finish!: (result: EuropePmcSearchResult) => void;
  let signal: AbortSignal | undefined;
  const search: EuropePmcMedicalEvidenceService['search'] = jest.fn(
    (_query, options) =>
      new Promise(resolve => {
        signal = options.signal;
        finish = resolve;
      }),
  );
  const route = await render(<RetainedSearchHarness search={search} />);
  await fireEvent.press(route.getByTestId('open-retained-search'));
  await fireEvent.changeText(
    route.getByTestId('external-evidence-query'),
    'sleep',
  );
  await fireEvent.press(route.getByTestId('external-evidence-search'));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  expect(route.getByTestId('external-evidence-loading')).toBeTruthy();
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(alert.mock.calls[0]?.[0]).toBe(
    navigationText.leaveUnsavedAndOperation.title,
  );
  (alert.mock.calls[0]?.[2] as AlertButton[])[0]?.onPress?.();
  await waitFor(() =>
    expect(route.getByTestId('external-evidence-loading')).toBeTruthy(),
  );
  expect(signal?.aborted).toBe(false);
  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  (alert.mock.calls[1]?.[2] as AlertButton[])[1]?.onPress?.();
  await waitFor(() =>
    expect(route.queryByTestId('external-medical-evidence-screen')).toBeNull(),
  );
  expect(signal?.aborted).toBe(true);
  await fireEvent.press(route.getByTestId('open-retained-search'));
  const readStatus = jest.fn(() => 'available' as const);
  // Observe consumption as well as the new screen: an unmounted React tree cannot
  // expose a stale state update, but an aborted response must not be processed.
  await act(async () => {
    finish({
      get status() {
        return readStatus();
      },
      publications,
    });
  });
  expect(readStatus).not.toHaveBeenCalled();
  expect(route.queryByTestId('external-evidence-loading')).toBeNull();
  expect(route.queryByTestId('external-evidence-selected-source')).toBeNull();
  expect(route.getByTestId('external-evidence-query').props.value).toBe('');
});

test('unmount during disclosure aborts consent and cannot start a late search', async () => {
  let authorize!: (decision: 'authorized') => void;
  let signal: AbortSignal | undefined;
  jest.spyOn(inferenceConsent, 'useInferenceConsent').mockReturnValue({
    consent: {
      authorize: request => {
        signal = request.signal;
        return new Promise(resolve => {
          authorize = resolve;
        });
      },
    },
    disclosureSheet: null,
  });
  const search = jest.fn();
  const route = await render(
    <ExternalMedicalEvidenceScreen
      onBack={jest.fn()}
      onOpenArticle={jest.fn()}
      service={{ search }}
    />,
  );
  await fireEvent.changeText(
    route.getByTestId('external-evidence-query'),
    'sleep',
  );
  await fireEvent.press(route.getByTestId('external-evidence-search'));
  expect(signal?.aborted).toBe(false);
  await route.unmount();
  expect(signal?.aborted).toBe(true);
  // Consent may settle even when its implementation cannot cancel the prompt.
  await act(async () => {
    authorize('authorized');
  });
  expect(search).not.toHaveBeenCalled();
});
