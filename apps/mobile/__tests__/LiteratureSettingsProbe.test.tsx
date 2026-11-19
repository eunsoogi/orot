import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react-native';
import { LiteratureSettingsProbe } from '../e2e/LiteratureSettingsProbe';
import { useLiteratureSearchObservation } from '../e2e/literatureVisualFixtures';
import { providerSelectionStore } from '../src/providers/selection/keychainSelectionStore';
import { saveModelSettingsConsent } from '../src/agent/execution/saveModelSettingsConsent';
import { searchConsentedMedicalEvidence } from '../src/externalMedicalEvidence/searchConsentedMedicalEvidence';

// Real settings component/hook and search admission; persistence is a controlled
// boundary here. Existing SQLite suites separately prove grant commit/revocation.
jest.mock('../src/agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: jest.fn(),
}));
beforeEach(() => {
  jest
    .mocked(saveModelSettingsConsent)
    .mockReset()
    .mockResolvedValue(undefined);
  jest.spyOn(providerSelectionStore, 'load').mockResolvedValue(null);
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Network forbidden in synthetic literature fixture');
  });
});
afterEach(() => jest.restoreAllMocks());

test('literature settings cancel writes nothing; only explicit medical toggle and confirmation save', async () => {
  const back = jest.fn();
  const view = await render(<LiteratureSettingsProbe onBack={back} />);
  await waitFor(() =>
    expect(
      view.getByTestId('provider-option-0').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('provider-option-0'));
  expect(view.getByTestId('settings-consent-medical').props.value).toBe(false);
  await fireEvent.press(view.getByTestId('provider-selection-cancel'));
  expect(saveModelSettingsConsent).not.toHaveBeenCalled();
  expect(back).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('provider-option-0'));
  await fireEvent(
    view.getByTestId('settings-consent-medical'),
    'valueChange',
    true,
  );
  expect(saveModelSettingsConsent).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('provider-selection-confirm'));
  await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  expect(saveModelSettingsConsent).toHaveBeenCalledTimes(1);
  expect(saveModelSettingsConsent).toHaveBeenCalledWith(
    expect.objectContaining({
      slot: 'conversation',
      store: providerSelectionStore,
      remote: false,
      search: { medical: true, web: false },
    }),
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('departed literature settings abort the pending decision and cannot route a late success', async () => {
  let finish!: () => void;
  jest.mocked(saveModelSettingsConsent).mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const back = jest.fn();
  const view = await render(<LiteratureSettingsProbe onBack={back} />);
  await waitFor(() =>
    expect(
      view.getByTestId('provider-option-0').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('provider-option-0'));
  await fireEvent(
    view.getByTestId('settings-consent-medical'),
    'valueChange',
    true,
  );
  const completion = fireEvent.press(
    view.getByTestId('provider-selection-confirm'),
  );
  await waitFor(() =>
    expect(saveModelSettingsConsent).toHaveBeenCalledTimes(1),
  );
  const input = jest.mocked(saveModelSettingsConsent).mock.calls[0][0];
  expect(input.isCurrent()).toBe(true);
  await act(() => view.unmount());
  expect(input.signal.aborted).toBe(true);
  expect(input.isCurrent()).toBe(false);
  await act(async () => {
    finish();
    await completion;
  });
  expect(back).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('synthetic search count stays zero on denial and counts only the explicit authorized transport', async () => {
  const { result } = await renderHook(useLiteratureSearchObservation);
  const signal = new AbortController().signal;
  await act(async () => {
    expect(
      await searchConsentedMedicalEvidence(
        { authorize: async () => 'renewal_required' },
        result.current.service,
        'sleep synthetic',
        signal,
      ),
    ).toBe('consent_required');
  });
  expect(result.current.count).toBe(0);
  await act(async () => {
    expect(
      await searchConsentedMedicalEvidence(
        {
          authorize: async () => 'authorized',
          isAuthorizationCurrent: () => true,
        },
        result.current.service,
        'sleep synthetic',
        signal,
      ),
    ).toEqual(expect.objectContaining({ status: 'available' }));
  });
  expect(result.current.count).toBe(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
