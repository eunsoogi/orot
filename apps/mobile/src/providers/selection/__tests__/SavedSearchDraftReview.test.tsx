import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text } from 'react-native';
import { SettingsConsentReadServicesContext } from '../../../agent/execution/SettingsConsentReadServices';
import type { SettingsConsentReadServices } from '../../../agent/execution/SettingsConsentReadServices';
import { SettingsSearchConsentChoices } from '../../../agent/execution/SettingsSearchConsentChoices';
import { settingsSearchGrants } from '../../../agent/execution/settingsSearchGrants';
import { settingsConsentRecipient } from '../../../agent/execution/settingsConsentRecipient';
import { useSavedSearchChoices } from '../useSavedSearchChoices';
import type { ProviderSelectionOption, ProviderSelectionStore } from '../types';

const selection = { providerId: 'chatgpt-plan:synthetic', modelId: 'same' };
const identity = {
  ...selection,
  recipient: settingsConsentRecipient(selection.providerId)!,
  authorityGeneration: 'test-generation',
  credentialEpoch: 'test-epoch',
};
const saved = settingsSearchGrants(identity, { web: true, medical: false })[0]!
  .grant;
const option = {
  provider: { id: selection.providerId, searchPublicWeb: jest.fn() },
  modelId: selection.modelId,
  privacyBoundary: 'selected-context-remote',
} as unknown as ProviderSelectionOption;
const store: ProviderSelectionStore & { liveWitness(): () => boolean } = {
  load: async () => selection,
  save: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  liveWitness: () => () => true,
};

function Review({ submit }: { submit: jest.Mock }) {
  const draft = useSavedSearchChoices(store);
  return (
    <>
      <Button title="Same" onPress={() => draft.choose(option, true)} />
      <Button
        title="Other"
        onPress={() => draft.choose({ ...option, modelId: 'other' })}
      />
      <Text>{draft.status}</Text>
      <SettingsSearchConsentChoices
        disabled={draft.status !== 'ready'}
        value={draft.choices}
        onChange={draft.change}
        webRecipient="Synthetic recipient"
      />
      <Button
        title="Confirm"
        onPress={() => {
          if (draft.canConfirm()) submit(draft.choices);
        }}
      />
    </>
  );
}
function fixture() {
  let complete!: (value: { status: 'present'; grant: typeof saved }) => void;
  const pending = new Promise<{ status: 'present'; grant: typeof saved }>(
    resolve => {
      complete = resolve;
    },
  );
  const readReviewGrant = jest.fn<
    ReturnType<NonNullable<SettingsConsentReadServices['readReviewGrant']>>,
    Parameters<NonNullable<SettingsConsentReadServices['readReviewGrant']>>
  >(async (_, domain) =>
    domain === 'public-web' ? pending : { status: 'unset' },
  );
  const services: SettingsConsentReadServices = {
    resolveOwner: async () => null,
    readGrant: async () => null,
    readReviewGrant,
    resolveTarget: async (slot, domain) => ({
      slot,
      domain,
      identity: saved.identity,
      isCurrent: () => true,
    }),
  };
  const submit = jest.fn();
  return {
    pending,
    readReviewGrant,
    services,
    submit,
    complete: () => complete({ status: 'present', grant: saved }),
  };
}

test('preserves same-model saved approval and submits an explicit switch-off', async () => {
  const f = fixture();
  await render(
    <SettingsConsentReadServicesContext.Provider value={f.services}>
      <Review submit={f.submit} />
    </SettingsConsentReadServicesContext.Provider>,
  );
  await fireEvent.press(screen.getByText('Same'));
  expect(screen.getByText('loading')).toBeTruthy();
  await fireEvent.press(screen.getByText('Confirm'));
  expect(f.submit).not.toHaveBeenCalled();
  await act(async () => {
    f.complete();
    await f.pending;
  });
  expect(screen.getByTestId('settings-consent-web').props.value).toBe(true);
  await fireEvent.press(screen.getByText('Confirm'));
  expect(f.submit).toHaveBeenLastCalledWith({ web: true, medical: false });
  await fireEvent(
    screen.getByTestId('settings-consent-web'),
    'valueChange',
    false,
  );
  await fireEvent.press(screen.getByText('Confirm'));
  expect(f.submit).toHaveBeenLastCalledWith({ web: false, medical: false });
});

test('late same-model restoration cannot overwrite a newer model draft or its explicit switch change', async () => {
  const f = fixture();
  await render(
    <SettingsConsentReadServicesContext.Provider value={f.services}>
      <Review submit={f.submit} />
    </SettingsConsentReadServicesContext.Provider>,
  );
  await fireEvent.press(screen.getByText('Same'));
  expect(f.readReviewGrant).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText('Other'));
  expect(screen.getByTestId('settings-consent-web').props.value).toBe(false);
  await fireEvent(
    screen.getByTestId('settings-consent-medical'),
    'valueChange',
    true,
  );
  await act(async () => {
    f.complete();
    await f.pending;
  });
  await fireEvent.press(screen.getByText('Confirm'));
  expect(f.submit).toHaveBeenLastCalledWith({ web: false, medical: true });
});

test('unreadable saved scope blocks confirmation instead of writing false', async () => {
  const f = fixture();
  f.readReviewGrant.mockResolvedValue({ status: 'unreadable' });
  await render(
    <SettingsConsentReadServicesContext.Provider value={f.services}>
      <Review submit={f.submit} />
    </SettingsConsentReadServicesContext.Provider>,
  );
  await fireEvent.press(screen.getByText('Same'));
  expect(screen.getByText('unreadable')).toBeTruthy();
  expect(screen.getByTestId('settings-consent-web').props.disabled).toBe(true);
  await fireEvent.press(screen.getByText('Confirm'));
  expect(f.submit).not.toHaveBeenCalled();
});
