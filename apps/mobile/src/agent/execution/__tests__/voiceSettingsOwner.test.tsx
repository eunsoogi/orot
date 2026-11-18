import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../ModelSettingsServices';
import { useVoiceCatalog } from '../../../voiceSettings/useVoiceCatalog';
import { useVoiceSelection } from '../../../voiceSettings/useVoiceSelection';
import { useVoiceConsentSave } from '../../../voiceSettings/useVoiceConsentSave';

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
      .current('openai-api', 'gpt-realtime-2.1-mini')
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
