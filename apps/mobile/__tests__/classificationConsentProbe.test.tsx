import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClassificationProbeScreen } from '../e2e/ClassificationProbeScreen';
import { ModelSettingsServicesContext } from '../src/agent/execution/ModelSettingsServices';
import { SettingsConsentReadServicesContext } from '../src/agent/execution/SettingsConsentReadServices';
import { classificationConsentFixture } from '../test-support/classificationConsentFixture';
import { calendarModelStore } from '../src/calendarModelSettings/calendarModelStore';
import { voiceSettingsStore } from '../src/voiceSettings/voiceSettingsStore';
import * as productionOwner from '../src/agent/execution/settingsConsentOwner';
import * as productionGrants from '../src/storage/settingsConsentRepository';

async function mount(staged = false) {
  const f = classificationConsentFixture();
  const forbidden = () => {
    throw new Error('Production fixture escape');
  };
  const spies = [
    jest
      .spyOn(productionOwner, 'resolveSettingsConsentOwner')
      .mockImplementation(forbidden),
    jest
      .spyOn(productionGrants, 'settingsConsentRepository')
      .mockImplementation(forbidden),
    jest.spyOn(calendarModelStore, 'load').mockImplementation(forbidden),
    jest
      .spyOn(voiceSettingsStore, 'accountStatus')
      .mockImplementation(forbidden),
    jest.spyOn(globalThis, 'fetch').mockImplementation(forbidden),
  ];
  const view = await render(
    <ModelSettingsServicesContext.Provider value={f.input.services}>
      <SettingsConsentReadServicesContext.Provider value={f.reads}>
        <ClassificationProbeScreen input={f.input} staged={staged} />
      </SettingsConsentReadServicesContext.Provider>
    </ModelSettingsServicesContext.Provider>,
  );
  const press = async (id: string) => fireEvent.press(view.getByTestId(id));
  const choose = async () => {
    await press('medical-appointment-select-provider');
    await waitFor(() =>
      expect(view.getByTestId('calendar-model-refresh')).not.toBeDisabled(),
    );
    await press('calendar-model-refresh');
    await waitFor(() =>
      expect(view.getByTestId('provider-option-0')).toBeTruthy(),
    );
    await press('provider-option-0');
    expect(
      view.getByTestId('model-settings-transmission-disclosure'),
    ).toHaveTextContent(/OpenAI API/);
  };
  const approve = async () => {
    await choose();
    await press('provider-selection-confirm');
    await waitFor(() =>
      expect(f.states.get('calendar')?.status).toBe('active'),
    );
    await waitFor(() =>
      expect(view.queryByTestId('provider-selection-confirm')).toBeNull(),
    );
    await press('classification-close-settings');
  };
  return {
    ...f,
    view,
    press,
    choose,
    approve,
    close: async () => {
      await view.unmount();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      }
      f.db.close();
    },
  };
}

test('real settings decline blocks send; approval admits only a redacted synthetic payload and failed output is never saved', async () => {
  const f = await mount();
  try {
    await f.press('medical-appointment-import');
    await waitFor(() =>
      expect(
        f.view.getByText(/이 요청의 AI 처리 승인이 필요해요/),
      ).toBeTruthy(),
    );
    expect(
      f.view.getByTestId('calendar-classification-synthetic-provider-calls'),
    ).toHaveTextContent('syntheticProviderCalls=0');
    expect(f.view.queryByTestId('inference-disclosure-sheet')).toBeNull();
    await f.choose();
    await f.press('provider-selection-cancel');
    expect(f.states.get('calendar')).toBeUndefined();
    await f.press('classification-close-settings');
    await f.approve();
    await f.press('medical-appointment-import');
    await waitFor(() =>
      expect(f.view.getByText(/선택한 AI의 응답을 받지 못했어요/)).toBeTruthy(),
    );
    expect(
      f.view.getByTestId('calendar-classification-synthetic-provider-calls'),
    ).toHaveTextContent('syntheticProviderCalls=1');
    expect(
      f.view.getByTestId('classification-synthetic-payload-privacy'),
    ).toHaveTextContent(
      'syntheticHealthIncluded=true;syntheticIdentifierExcluded=true',
    );
    expect(
      f.view.queryByTestId('calendar-classification-synthetic-calendar-save'),
    ).toBeNull();
    expect(f.view.queryByTestId('medical-appointment-manual')).toBeNull();
  } finally {
    await f.close();
  }
}, 30000);

test('approved staged fixture completes actual 8+1 classification batches and gated saves', async () => {
  const f = await mount(true);
  try {
    await f.approve();
    await f.press('medical-appointment-import');
    await waitFor(() =>
      expect(
        f.view.getByTestId('classification-release-response'),
      ).toHaveTextContent(/model/),
    );
    expect(f.view.getByTestId('medical-appointment-progress')).toBeTruthy();
    const privacy = f.view.getByTestId(
      'classification-synthetic-payload-privacy',
    );
    expect(privacy).toHaveProp(
      'accessibilityLabel',
      'syntheticHealthIncluded=true;syntheticIdentifierExcluded=true',
    );
    for (const diagnostic of [
      privacy,
      f.view.getByTestId('calendar-classification-synthetic-provider-calls'),
      f.view.getByText('Synthetic gate: model'),
    ]) {
      expect(diagnostic).toHaveProp('allowFontScaling', false);
      expect(diagnostic).toHaveProp('numberOfLines', 1);
    }
    await f.press('classification-release-response');
    await waitFor(() =>
      expect(
        f.view.getByTestId('calendar-classification-synthetic-provider-calls'),
      ).toHaveTextContent('syntheticProviderCalls=2'),
    );
    await f.press('classification-release-response');
    await waitFor(() =>
      expect(
        f.view.getByTestId('classification-release-response'),
      ).toHaveTextContent(/save/),
    );
    await f.press('classification-release-response');
    await waitFor(() =>
      expect(f.view.getByTestId('medical-appointment-results')).toBeTruthy(),
    );
    expect(
      f.view.getByTestId('calendar-classification-synthetic-calendar-save'),
    ).toHaveTextContent(/confirmed/);
    expect(
      f.view.getByTestId('calendar-classification-synthetic-calendar-save'),
    ).toHaveProp('numberOfLines', 1);
  } finally {
    await f.close();
  }
}, 30000);

test('revoking real settings authority during a gated response prevents publication and saves', async () => {
  const f = await mount(true);
  try {
    await f.approve();
    await f.press('medical-appointment-import');
    await waitFor(() =>
      expect(
        f.view.getByTestId('classification-release-response'),
      ).toHaveTextContent(/model/),
    );
    await act(async () => {
      await f.input.fixture.revoke(true);
    });
    await f.press('classification-release-response');
    await waitFor(() =>
      expect(f.view.queryByTestId('medical-appointment-progress')).toBeNull(),
    );
    expect(
      f.view.queryByTestId('calendar-classification-synthetic-calendar-save'),
    ).toBeNull();
    expect(
      f.view.getByTestId('calendar-classification-synthetic-provider-calls'),
    ).toHaveTextContent('syntheticProviderCalls=1');
    expect(
      f.view.queryByTestId('medical-appointment-save-calendar-candidate-1'),
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 30000);
