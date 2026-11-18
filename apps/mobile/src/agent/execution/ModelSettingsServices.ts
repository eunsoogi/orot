import { createCalendarDecisionsOption } from '../../calendarModelSettings/decisionsProvider';
import type { ProviderSelectionStore } from '../../providers/selection/types';
import { createContext, useContext } from 'react';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { calendarModelStore } from '../../calendarModelSettings/calendarModelStore';
import { saveModelSettingsConsent } from './saveModelSettingsConsent';

export interface ModelSettingsServices {
  readonly voice: Pick<
    typeof voiceSettingsStore,
    'load' | 'save' | 'accountStatus' | 'discoverModels' | 'subscribe'
  >;
  readonly calendar: ProviderSelectionStore;
  readonly calendarOption: typeof createCalendarDecisionsOption;
  readonly saveConsent: typeof saveModelSettingsConsent;
}

// Production defaults are unchanged. A scoped synthetic native host can provide
// isolated storage and transports without changing global credential singletons.
const productionServices: ModelSettingsServices = {
  voice: voiceSettingsStore,
  calendar: calendarModelStore,
  calendarOption: createCalendarDecisionsOption,
  saveConsent: saveModelSettingsConsent,
};
export const ModelSettingsServicesContext = createContext(productionServices);
export function useModelSettingsServices() {
  const value = useContext(ModelSettingsServicesContext);
  if (
    !value ||
    typeof value.saveConsent !== 'function' ||
    typeof value.calendarOption !== 'function' ||
    !value.calendar ||
    !value.voice ||
    !['load', 'save', 'clear'].every(
      key => typeof Reflect.get(value.calendar, key) === 'function',
    ) ||
    !['load', 'save', 'accountStatus', 'discoverModels', 'subscribe'].every(
      key => typeof Reflect.get(value.voice, key) === 'function',
    )
  )
    throw new Error('Complete model settings services required');
  return value;
}
