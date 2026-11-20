import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../ModelSettingsServices';
import { useVoiceCatalog } from '../../../voiceSettings/useVoiceCatalog';
import { useVoiceSelection } from '../../../voiceSettings/useVoiceSelection';
import { useVoiceConsentSave } from '../../../voiceSettings/useVoiceConsentSave';
import { useLiveVoiceSettingsSave } from '../../../voiceSettings/useLiveVoiceSettingsSave';
import {
  initialPreferences,
  liveModel,
} from '../../../voiceSettings/liveVoicePreferences';

function services(): ModelSettingsServices {
  return {
    saveConsent: async () => {},
    calendar: {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    },
    calendarOption: () => {
      throw new Error('Unused synthetic calendar');
    },
    voice: {
      load: async () => ({
        mode: 'local',
        model: 'apple-system-speech',
        hasApiKey: true,
      }),
      save: async () => {},
      accountStatus: async () => ({ connected: true, revision: 1 }),
      discoverModels: async () => ({
        revision: 1,
        ids: ['gpt-realtime-2.1-mini'],
      }),
      subscribe: () => () => {},
    },
  };
}

test('same numeric account revision cannot retain a previous service catalog', async () => {
  let owner = services();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ModelSettingsServicesContext.Provider value={owner}>
      {children}
    </ModelSettingsServicesContext.Provider>
  );
  const view = await renderHook(useVoiceCatalog, { wrapper });
  await waitFor(() => expect(view.result.current.connected).toBe(true));
  await act(() => view.result.current.refresh());
  expect(view.result.current.fresh).toBe(true);
  owner = services();
  await view.rerender(undefined);
  await waitFor(() => expect(view.result.current.connected).toBe(true));
  expect(view.result.current.fresh).toBe(false);
  expect(view.result.current.ids).toEqual([]);
  await view.unmount();
});

test('late load from the replaced voice owner never overwrites the new selection', async () => {
  let finish!: (
    value: Awaited<ReturnType<ModelSettingsServices['voice']['load']>>,
  ) => void;
  let owner = services();
  owner.voice.load = () =>
    new Promise(resolve => {
      finish = resolve;
    });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ModelSettingsServicesContext.Provider value={owner}>
      {children}
    </ModelSettingsServicesContext.Provider>
  );
  const view = await renderHook(() => useVoiceSelection(useVoiceCatalog()), {
    wrapper,
  });
  owner = services();
  await view.rerender(undefined);
  await waitFor(() => expect(view.result.current.busy).toBe(false));
  await act(async () => {
    finish({ mode: 'openai-api', model: 'old-account-model', hasApiKey: true });
  });
  expect(view.result.current.savedModel).toBe('apple-system-speech');
  await view.unmount();
});

test('account revision replacement aborts a pending voice grant with the same service function', async () => {
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const owner: ModelSettingsServices = {
    ...services(),
    saveConsent: async input => {
      signal = input.signal;
      await new Promise<void>(resolve => {
        finish = resolve;
      });
    },
  };
  let revision = 1;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ModelSettingsServicesContext.Provider value={owner}>
      {children}
    </ModelSettingsServicesContext.Provider>
  );
  const view = await renderHook(() => useVoiceConsentSave(revision), {
    wrapper,
  });
  let rejected = false;
  let operation!: Promise<void>;
  await act(() => {
    operation = view.result
      .current('openai-api', 'gpt-realtime-2.1-mini', () => true)
      .catch(() => {
        rejected = true;
      });
  });
  expect(signal?.aborted).toBe(false);
  revision = 2;
  await view.rerender(undefined);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish();
    await operation;
  });
  expect(rejected).toBe(true);
  await view.unmount();
});

test('hiding and returning to retained voice tab cannot revive an approved held writer', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let writerCurrent: (() => boolean) | undefined;
  const committed = jest.fn();
  const setPreference = jest.fn(async () => {});
  const preferences = { load: jest.fn(), save: setPreference };
  const owner: ModelSettingsServices = {
    ...services(),
    saveConsent: async input => {
      writerCurrent = input.isCurrent;
      await held;
      if (!input.isCurrent()) throw new Error('Settings draft expired');
      committed(input.selection);
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ModelSettingsServicesContext.Provider value={owner}>
      {children}
    </ModelSettingsServicesContext.Provider>
  );
  const view = await renderHook(
    ({ active }: { active: boolean }) => {
      const selection = useVoiceSelection(useVoiceCatalog());
      return {
        selection,
        sheet: useLiveVoiceSettingsSave({
          active,
          disabled: selection.busy,
          canApproveNew: true,
          mode: selection.mode,
          model: selection.model,
          savedModel: selection.savedModel,
          revision: 1,
          save: selection.save,
          store: preferences,
        }),
      };
    },
    { initialProps: { active: true }, wrapper },
  );
  await waitFor(() => expect(view.result.current.selection.busy).toBe(false));
  await act(async () =>
    view.result.current.selection.choose('openai-api', liveModel),
  );
  await act(async () =>
    view.result.current.sheet.setPrefs({
      owner: 'synthetic',
      preferences: { ...initialPreferences, voice: 'noeul' },
      dirty: true,
    }),
  );
  await act(async () => {
    void view.result.current.sheet.confirmSave();
  });
  await act(async () =>
    view.result.current.sheet.disclosureSheet?.props.onDecision(true),
  );
  await waitFor(() => expect(writerCurrent?.()).toBe(true));
  await view.rerender({ active: false });
  expect(writerCurrent?.()).toBe(false);
  await view.rerender({ active: true });
  expect(writerCurrent?.()).toBe(false);
  await act(async () => release());
  expect(committed).not.toHaveBeenCalled();
  expect(setPreference).not.toHaveBeenCalled();
  expect(view.result.current.selection.savedModel).toBe('apple-system-speech');
  await view.unmount();
});
