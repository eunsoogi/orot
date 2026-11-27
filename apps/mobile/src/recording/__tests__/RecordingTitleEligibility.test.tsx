import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import {
  APPLE_FOUNDATION_MODEL_SELECTION_ID,
  createAppleSelectionOption,
  loadAppleSelectionOption,
} from '../../providers/selection/options';
import type { ProviderSelection } from '../../providers/selection/types';
import { useRecordingTitleEligibility } from '../useRecordingTitleEligibility';

jest.mock('../../providers/selection/options', () => ({
  ...jest.requireActual('../../providers/selection/options'),
  loadAppleSelectionOption: jest.fn(),
}));

test('only a current available on-device selection exposes the optional title action', async () => {
  const apple = createAppleSelectionOption('available');
  const local = {
    providerId: APPLE_PROVIDER_ID,
    modelId: APPLE_FOUNDATION_MODEL_SELECTION_ID,
  };
  let choice: ProviderSelection | null = null;
  let revision = 0;
  let changed = () => {};
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const stop = jest
    .spyOn(providerSelectionStore, 'subscribeChanges')
    .mockImplementation(listener => {
      changed = listener;
      return () => {};
    });
  jest.spyOn(providerSelectionStore, 'liveWitness').mockImplementation(() => {
    const token = revision;
    return () => token === revision;
  });
  jest
    .spyOn(providerSelectionStore, 'load')
    .mockImplementation(async () => choice);
  const available = jest.mocked(loadAppleSelectionOption);
  const owner = { isCurrent: () => true, subscribe: () => () => {} };
  try {
    const { result } = await renderHook(() =>
      useRecordingTitleEligibility('source-a', owner, true),
    );
    async function select(next: ProviderSelection) {
      await act(async () => {
        choice = next;
        revision++;
        changed();
      });
    }
    expect(result.current()).toBe(false);
    await select({
      providerId: 'chatgpt-plan:synthetic',
      modelId: 'synthetic',
    });
    expect(result.current()).toBe(false);
    expect(available).not.toHaveBeenCalled();

    available.mockResolvedValueOnce(
      createAppleSelectionOption('modelNotReady'),
    );
    await select(local);
    expect(result.current()).toBe(false);

    let release!: (option: typeof apple) => void;
    available.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    await select(local);
    await select({
      providerId: 'chatgpt-plan:synthetic',
      modelId: 'synthetic',
    });
    await act(async () => {
      release(apple);
    });
    expect(result.current()).toBe(false);

    available.mockResolvedValueOnce(apple);
    await select(local);
    await waitFor(() => expect(result.current()).toBe(true));
    await select({
      providerId: 'chatgpt-plan:synthetic',
      modelId: 'synthetic',
    });
    expect(result.current()).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    AppState.currentState = previous;
    jest.restoreAllMocks();
  }
});
