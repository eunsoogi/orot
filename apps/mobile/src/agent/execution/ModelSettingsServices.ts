import { prepareJointCalendarReview } from './prepareJointCalendarReview';
import { createCalendarDecisionsOption } from '../../calendarModelSettings/decisionsProvider';
import type { saveReviewedOpenAiVoicePair } from '../../voiceSettings/saveReviewedOpenAiVoicePair';
import type { ProviderSelectionStore } from '../../providers/selection/types';
import { createContext, useContext } from 'react';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { calendarModelStore } from '../../calendarModelSettings/calendarModelStore';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { alreadyApprovedModelSettings } from './alreadyApprovedModelSettings';
import { productionSettingsConsentReadServices } from './SettingsConsentReadServices';
import { saveModelSettingsConsent } from './saveModelSettingsConsent';

export interface ModelSettingsServices {
  readonly voice: Pick<
    typeof voiceSettingsStore,
    | 'load'
    | 'save'
    | 'accountStatus'
    | 'accountRevisionMatches'
    | 'discoverModels'
    | 'subscribe'
  >;
  readonly voicePair?: {
    readonly runtimeAvailable: boolean;
    readonly commonTools?: true;
    readonly commit: typeof saveReviewedOpenAiVoicePair;
  };
  readonly calendar: ProviderSelectionStore;
  readonly calendarOption: typeof createCalendarDecisionsOption;
  readonly saveConsent: typeof saveModelSettingsConsent;
  readonly prepareJointCalendarReview?: (
    ...input: [
      ...Parameters<typeof prepareJointCalendarReview>,
      ProviderSelectionStore,
    ]
  ) => ReturnType<typeof prepareJointCalendarReview>;
  readonly reuseApproval?: (
    input: Omit<Parameters<typeof alreadyApprovedModelSettings>[0], 'services'>,
    store: ProviderSelectionStore,
  ) => Promise<boolean>;
}

const commonVoicePair: NonNullable<ModelSettingsServices['voicePair']> = {
  runtimeAvailable: true,
  commonTools: true,
  commit: (...args) => {
    const { saveReviewedOpenAiVoicePair: save } =
      require('../../voiceSettings/saveReviewedOpenAiVoicePair') as typeof import('../../voiceSettings/saveReviewedOpenAiVoicePair');
    return save(...args);
  },
};

// A scoped synthetic native host can still provide isolated stores/capabilities.
const productionServices: ModelSettingsServices = {
  voice: voiceSettingsStore,
  get voicePair() {
    const { hasLiveCommonConversationRuntime } =
      require('../../voiceConversation/nativeLiveCommonConversation') as typeof import('../../voiceConversation/nativeLiveCommonConversation');
    return hasLiveCommonConversationRuntime() ? commonVoicePair : undefined;
  },
  calendar: calendarModelStore,
  calendarOption: createCalendarDecisionsOption,
  saveConsent: saveModelSettingsConsent,
  prepareJointCalendarReview: (option, search, signal, current, store) =>
    store === providerSelectionStore
      ? prepareJointCalendarReview(option, search, signal, current)
      : Promise.resolve(null),
  reuseApproval: (input, store) =>
    store ===
    (input.slot === 'calendar' ? calendarModelStore : providerSelectionStore)
      ? alreadyApprovedModelSettings({
          ...input,
          services: productionSettingsConsentReadServices,
        })
      : Promise.resolve(false),
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
