import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { medicalAppointmentCopy as copy } from '../copy.ko';
import {
  calendarSyncState,
  event,
  renderScreen,
  repository,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

import { resolveSettingsConsentOwner } from '../../agent/execution/settingsConsentOwner';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { settingsPermissionsForFeature } from '../../agent/execution/settingsConsentCatalog';
jest.mock('../../agent/execution/settingsConsentOwner', () => ({
  resolveSettingsConsentOwner: jest.fn(),
}));
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));

const importAction = () => screen.getByTestId('medical-appointment-import');

test('opens model selection from the displayed classification model', async () => {
  const { onOpenProviderSelection } = await renderScreen([[]], repository());
  await fireEvent.press(
    screen.getByTestId('medical-appointment-select-provider'),
  );
  expect(onOpenProviderSelection).toHaveBeenCalledTimes(1);
});

test('keeps the unselected model action concise without enabling classification', async () => {
  const { onOpenProviderSelection } = await renderScreen(
    [[]],
    repository(),
    null,
  );
  const selector = screen.getByTestId('medical-appointment-select-provider');
  expect(selector).toHaveTextContent('AI 선택');
  expect(selector).not.toHaveTextContent(copy.noProvider);
  expect(importAction()).toBeDisabled();
  await fireEvent.press(selector);
  expect(onOpenProviderSelection).toHaveBeenCalledTimes(1);
});

test.each(['approved', 'missing', 'revoked', 'wrong-recipient'] as const)(
  'checks settings permission without a repeated modal or manual entry: %s',
  async state => {
    const selected = selectedProvider();
    const remote = {
      ...selected,
      privacyBoundary: 'selected-context-remote' as const,
    };
    const identity = {
      providerId: remote.provider.id,
      modelId: remote.modelId,
      recipient: 'selected-account',
      authorityGeneration: 'synthetic-generation',
      credentialEpoch: 'synthetic-credential',
    };
    jest.mocked(resolveSettingsConsentOwner).mockResolvedValue({
      slot: 'calendar',
      domain: 'model',
      identity,
      isCurrent: () => state !== 'revoked',
    });
    jest.mocked(settingsConsentRepository).mockResolvedValue({
      read: jest.fn(async () =>
        state === 'missing'
          ? null
          : {
              version: 1,
              catalogVersion: 'model-settings-v1',
              identity: {
                ...identity,
                recipient:
                  state === 'wrong-recipient'
                    ? 'Other account'
                    : identity.recipient,
              },
              permissions: settingsPermissionsForFeature('calendar'),
            },
      ),
    } as never);
    const appointments = repository();
    const { bridge, onOpenManual } = await renderScreen(
      [[event('private-calendar-id', '치과 진료', '2035-06-02')]],
      appointments,
      remote,
    );
    await fireEvent.press(importAction());
    expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
    expect(screen.queryByText(/private-calendar-id/)).toBeNull();
    expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
    await waitFor(() => expect(importAction()).not.toBeDisabled());
    expect(
      screen.getByText(
        state === 'approved'
          ? /선택한 AI의 응답을 받지 못했어요/
          : /이 요청의 AI 처리 승인이 필요해요/,
      ),
    ).toBeTruthy();
    expect(selected.provider.generate).toHaveBeenCalledTimes(
      state === 'approved' ? 1 : 0,
    );
    if (state === 'approved') {
      // The former expanded disclosure assertion now checks the actual admitted payload.
      const payload = JSON.stringify(
        jest.mocked(selected.provider.generate).mock.calls[0]![0],
      );
      expect(payload).toContain('치과 진료');
      expect(payload).not.toContain('private-calendar-id');
    }
    expect(
      screen.queryByTestId('medical-appointment-save-calendar-candidate-1'),
    ).toBeNull();
    expect(screen.queryByText('치과 진료')).toBeNull();
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('medical-appointment-manual')).toBeNull();
    expect(onOpenManual).not.toHaveBeenCalled();
  },
  30000,
);

test('keeps Calendar settings but removes manual entry when Calendar permission is denied without invoking AI or saving', async () => {
  const appointments = repository();
  const selected = selectedProvider();
  const { bridge, onOpenManual, onOpenCalendarSettings } = await renderScreen(
    [[]],
    appointments,
    selected,
    calendarSyncState([], 'denied'),
  );
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.permissionUnavailable)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('medical-appointment-calendar-settings'),
  );
  expect(screen.queryByTestId('medical-appointment-manual')).toBeNull();
  expect(onOpenManual).not.toHaveBeenCalled();
  expect(onOpenCalendarSettings).toHaveBeenCalledTimes(1);
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
  expect(selected.provider.generate).not.toHaveBeenCalled();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(appointments.create).not.toHaveBeenCalled();
});

test('does not save unclassified events when no AI has been selected', async () => {
  const appointments = repository();
  const { onOpenManual } = await renderScreen(
    [[event('no-provider', '진료', '2035-06-02')]],
    appointments,
    null,
  );
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.chooseProvider)).toBeTruthy();
  expect(importAction()).toBeDisabled();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(screen.queryByText('진료')).toBeNull();
  expect(screen.queryByTestId('medical-appointment-manual')).toBeNull();
  expect(onOpenManual).not.toHaveBeenCalled();
});
