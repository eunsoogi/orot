import { useModelSettingsReview } from '../agent/execution/useModelSettingsReview';
import { useModelConsentSave } from '../agent/execution/useModelConsentSave';
import { t } from '../i18n';
import type { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionResolution,
} from '../providers/selection/types';

export function useCalendarModelConfirmation({
  services,
  pending,
  current,
  resolution,
  generation,
  accountRevision,
  saving,
  loadError,
  setSaving,
  setSaved,
  setPending,
  setMessage,
}: {
  services: ReturnType<typeof useModelSettingsServices>;
  pending: ProviderSelectionOption | null;
  current: ProviderSelectionOption | undefined;
  resolution: ProviderSelectionResolution | null;
  generation: { current: number };
  accountRevision: { current: number | null };
  saving: boolean;
  loadError: boolean;
  setSaving: (value: boolean) => void;
  setSaved: (value: ProviderSelection) => void;
  setPending: (value: ProviderSelectionOption | null) => void;
  setMessage: (value: string) => void;
}) {
  const { calendar: calendarModelStore, voice: voiceSettingsStore } = services;
  const saveConsent = useModelConsentSave('calendar', calendarModelStore);
  const consent = useModelSettingsReview(
    'calendar',
    true,
    services,
    JSON.stringify([
      pending?.provider.id,
      pending?.modelId,
      current?.privacyBoundary,
      resolution?.ok,
      generation.current,
    ]),
    calendarModelStore,
  );
  async function confirm() {
    if (
      !pending ||
      !current ||
      resolution?.ok !== true ||
      saving ||
      consent.isReviewing() ||
      loadError
    )
      return;
    const owner = generation.current;
    setSaving(true);
    try {
      const selection = {
        providerId: current.provider.id,
        modelId: current.modelId,
      };
      const saved = await consent.review(
        current,
        undefined,
        async isCurrent => {
          const owned = () => isCurrent() && owner === generation.current;
          if (current.provider.id === 'openai-api-decisions') {
            const account = await voiceSettingsStore.accountStatus();
            if (
              !owned() ||
              !account.connected ||
              account.revision !== accountRevision.current
            )
              throw new Error('Account unavailable');
          }
          await saveConsent(current, undefined, owned);
        },
      );
      if (!saved) return;
      if (owner !== generation.current) return;
      setSaved(selection);
      setPending(null);
      setMessage('');
    } catch {
      if (owner === generation.current)
        setMessage(t('modelSettings.accountReadFailed'));
    } finally {
      if (owner === generation.current) setSaving(false);
    }
  }

  return {
    confirm: () => {
      void confirm();
    },
    disclosureSheet: consent.disclosureSheet,
  };
}
