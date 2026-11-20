import { act, renderHook } from '@testing-library/react-native';
import { useLiveVoiceSettingsSave } from '../useLiveVoiceSettingsSave';
import { initialPreferences, liveModel } from '../liveVoicePreferences';

const mockAuthorize = jest.fn(
  async () => 'authorized' as 'authorized' | 'renewal_required',
);
const mockConsent = {
  authorize: mockAuthorize,
  isAuthorizationCurrent: () => true,
};
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({ consent: mockConsent }),
}));

function fixture(savedModel: string | null = liveModel) {
  const save = jest.fn(async () => true);
  const store = { load: jest.fn(), save: jest.fn(async () => {}) };
  return {
    active: true,
    disabled: false,
    canApproveNew: true,
    mode: 'openai-api' as const,
    model: liveModel,
    savedModel,
    revision: 5,
    save,
    store,
  };
}

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue('authorized');
});
afterEach(() => jest.restoreAllMocks());

it('uses a still-current saved Live grant to save only the new voice preference', async () => {
  const input = { ...fixture(), canApproveNew: false };
  const form = await renderHook(() => useLiveVoiceSettingsSave(input));
  const draft = { ...initialPreferences, voice: 'noeul' as const };
  await act(async () =>
    form.result.current.setPrefs({
      owner: 'synthetic',
      preferences: draft,
      dirty: true,
    }),
  );
  await act(async () => {
    void form.result.current.confirmSave();
  });
  expect(mockAuthorize).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: 'openai-live',
      recipient: 'OpenAI Live API',
      allowedScope: { sourceKinds: [] },
    }),
  );
  expect(form.result.current.disclosureSheet).toBeNull();
  expect(input.save).not.toHaveBeenCalled();
  expect(input.store.save).toHaveBeenCalledWith('synthetic', draft);
  expect(form.result.current.saveRevision).toBe(1);
});

it('does not persist a new grant or preferences when cancelled or ownership changes', async () => {
  const input = fixture('gpt-realtime-2.1');
  const form = await renderHook(
    (props: typeof input) => useLiveVoiceSettingsSave(props),
    { initialProps: input },
  );
  await act(async () =>
    form.result.current.setPrefs({
      owner: 'synthetic',
      preferences: { ...initialPreferences, voice: 'noeul' },
      dirty: true,
    }),
  );
  await act(async () => {
    void form.result.current.confirmSave();
  });
  expect(form.result.current.disclosureSheet).not.toBeNull();
  const decide = (value: boolean) =>
    form.result.current.disclosureSheet?.props.onDecision(value);
  await act(async () => decide(false));
  expect(input.save).not.toHaveBeenCalled();
  expect(input.store.save).not.toHaveBeenCalled();
  await act(async () => {
    void form.result.current.confirmSave();
  });
  const stale = form.result.current.disclosureSheet?.props.onDecision;
  await form.rerender({ ...input, revision: 6 });
  await act(async () => stale?.(true));
  expect(input.save).not.toHaveBeenCalled();
  expect(input.store.save).not.toHaveBeenCalled();
});

it('writes preferences only after an explicit successful model approval', async () => {
  const input = fixture('gpt-realtime-2.1');
  const form = await renderHook(() => useLiveVoiceSettingsSave(input));
  const draft = { ...initialPreferences, voice: 'noeul' as const };
  await act(async () =>
    form.result.current.setPrefs({
      owner: 'synthetic',
      preferences: draft,
      dirty: true,
    }),
  );
  await act(async () => {
    void form.result.current.confirmSave();
  });
  expect(input.save).not.toHaveBeenCalled();
  await act(async () =>
    form.result.current.disclosureSheet?.props.onDecision(true),
  );
  expect(input.save).toHaveBeenCalledTimes(1);
  expect(input.store.save).toHaveBeenCalledTimes(1);
  expect(input.save.mock.invocationCallOrder[0]).toBeLessThan(
    input.store.save.mock.invocationCallOrder[0]!,
  );
});
