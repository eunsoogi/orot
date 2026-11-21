import { useEffect, useRef, useState } from 'react';
import { useSettingsConsentReadServices } from '../../agent/execution/SettingsConsentReadServices';
import {
  readSavedModelSearchChoices,
  uncheckedSearchChoices,
} from '../../agent/execution/savedModelSearchChoices';
import type { SettingsSearchChoices } from '../../agent/execution/settingsSearchGrants';
import type { ProviderSelectionOption, ProviderSelectionStore } from './types';

type State =
  | { status: 'loading' | 'unreadable' }
  | { status: 'ready'; choices: SettingsSearchChoices; current(): boolean };

/** Only an unchanged selected target can preload saved choices. A draft toggle is never overwritten. */
export function useSavedSearchChoices(store: ProviderSelectionStore) {
  const services = useSettingsConsentReadServices();
  const read = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<State>({
    status: 'ready',
    choices: uncheckedSearchChoices,
    current: () => true,
  });
  useEffect(() => () => read.current?.abort(), [services, store]);
  function choose(option?: ProviderSelectionOption, sameTarget = false) {
    read.current?.abort();
    if (!option || !sameTarget) {
      setState({
        status: 'ready',
        choices: uncheckedSearchChoices,
        current: () => true,
      });
      return;
    }
    const controller = new AbortController();
    read.current = controller;
    setState({ status: 'loading' });
    const selected = {
      providerId: option.provider.id,
      modelId: option.modelId,
    };
    (async () => {
      try {
        const witness =
          'liveWitness' in store && typeof store.liveWitness === 'function'
            ? (store.liveWitness() as (() => boolean) | undefined)
            : undefined;
        if (typeof witness !== 'function')
          throw new Error('Search settings owner unavailable');
        const saved = await store.load();
        if (
          saved?.providerId !== selected.providerId ||
          saved.modelId !== selected.modelId
        )
          throw new Error('Search settings owner changed');
        const result = await readSavedModelSearchChoices(
          services,
          option,
          controller.signal,
        );
        if (controller.signal.aborted || read.current !== controller) return;
        const current = () => witness() && result?.current() === true;
        setState(
          result && current()
            ? { status: 'ready', choices: result.choices, current }
            : { status: 'unreadable' },
        );
      } catch {
        if (!controller.signal.aborted && read.current === controller)
          setState({ status: 'unreadable' });
      }
    })();
  }
  return {
    choose,
    status: state.status,
    choices: state.status === 'ready' ? state.choices : uncheckedSearchChoices,
    change(choices: SettingsSearchChoices) {
      setState(value =>
        value.status === 'ready' && value.current()
          ? { ...value, choices }
          : value,
      );
    },
    canConfirm() {
      if (state.status !== 'ready') return false;
      if (state.current()) return true;
      setState({ status: 'unreadable' });
      return false;
    },
  };
}
