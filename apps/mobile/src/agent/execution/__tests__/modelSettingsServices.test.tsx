import {
  act,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react-native';
import { Button } from 'react-native';
import {
  ModelSettingsServicesContext,
  useModelSettingsServices,
  type ModelSettingsServices,
} from '../ModelSettingsServices';
import { useModelConsentSave } from '../useModelConsentSave';

function services(
  saveConsent: ModelSettingsServices['saveConsent'],
): ModelSettingsServices {
  return {
    saveConsent,
    calendarOption() {
      throw new Error('Not used by hook fixture');
    },
    calendar: {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    },
    voice: {
      load: async () => ({
        mode: 'local',
        model: 'apple-system-speech',
        hasApiKey: false,
      }),
      save: async () => {},
      accountStatus: async () => ({ connected: false, revision: 1 }),
      discoverModels: async () => ({ revision: 1, ids: [] }),
      subscribe: () => () => {},
    },
  };
}

test.each([null, {}, { voice: null }])(
  'partial injected service %s never falls back to production',
  async value => {
    const logging = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        renderHook(useModelSettingsServices, {
          wrapper: ({ children }) => (
            <ModelSettingsServicesContext.Provider
              value={value as unknown as ModelSettingsServices}
            >
              {children}
            </ModelSettingsServicesContext.Provider>
          ),
        }),
      ).rejects.toThrow('Complete model settings services required');
    } finally {
      logging.mockRestore();
    }
  },
);

test.each([
  'replacement',
  'same-function-owner',
  'store',
  'slot',
  'unmount',
] as const)('%s aborts a pending scoped settings save', async kind => {
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => {
    finish = resolve;
  });
  const first = services(async input => {
    signal = input.signal;
    await waiting;
  });
  const nextSave = jest.fn(async () => {});
  const second = services(
    kind === 'same-function-owner' ? first.saveConsent : nextSave,
  );
  let result: Promise<void> | undefined;
  let rejected = false;
  function Probe({ changed = false }: { changed?: boolean }) {
    const save = useModelConsentSave(
      changed && kind === 'slot' ? 'calendar' : 'conversation',
      changed && kind === 'store' ? second.calendar : first.calendar,
    );
    return (
      <Button
        title="Synthetic save"
        onPress={() => {
          result = save({
            provider: { id: 'openai-api-decisions' },
            modelId: 'synthetic',
            privacyBoundary: 'selected-context-remote',
          }).catch(() => {
            rejected = true;
          });
        }}
      />
    );
  }
  const view = await render(
    <ModelSettingsServicesContext.Provider value={first}>
      <Probe />
    </ModelSettingsServicesContext.Provider>,
  );
  await fireEvent.press(view.getByText('Synthetic save'));
  expect(signal?.aborted).toBe(false);
  if (kind !== 'unmount')
    await view.rerender(
      <ModelSettingsServicesContext.Provider
        value={kind === 'store' || kind === 'slot' ? first : second}
      >
        <Probe changed />
      </ModelSettingsServicesContext.Provider>,
    );
  else await act(() => view.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish();
    await result;
  });
  expect(rejected).toBe(true);
  expect(nextSave).not.toHaveBeenCalled();
  if (kind !== 'unmount') await act(() => view.unmount());
});
