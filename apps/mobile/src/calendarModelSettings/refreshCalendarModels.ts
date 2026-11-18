import type { MutableRefObject } from 'react';
import type { ProviderSelectionOption } from '../providers/selection/types';
import type { ModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { t } from '../i18n';

/** Catalog discovery publishes only to its captured owner generation; no grant or verdict is reused. */
export async function refreshCalendarModels(input: {
  services: ModelSettingsServices;
  generation: MutableRefObject<number>;
  controller: MutableRefObject<AbortController | null>;
  accountRevision: MutableRefObject<number | null>;
  setRefreshing(value: boolean): void;
  setApiOptions(value: ProviderSelectionOption[]): void;
  setMessage(value: string): void;
}) {
  const {
    generation,
    controller,
    accountRevision,
    setRefreshing,
    setApiOptions,
    setMessage,
  } = input;
  const request = ++generation.current;
  controller.current?.abort();
  setRefreshing(true);
  setApiOptions([]);
  const abort = new AbortController();
  controller.current = abort;
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const result = await input.services.voice.discoverModels(abort.signal);
    if (request !== generation.current || abort.signal.aborted) return;
    accountRevision.current = result.revision;
    const supported = result.ids.filter(id => id === 'gpt-6-luna');
    setApiOptions(
      supported.map(id => input.services.calendarOption(id, result.revision)),
    );
    setMessage(supported.length ? '' : t('modelSettings.noDecisionModels'));
  } catch {
    if (request === generation.current)
      setMessage(t('modelSettings.modelLoadFailed'));
  } finally {
    clearTimeout(timeout);
    if (request === generation.current) setRefreshing(false);
  }
}
