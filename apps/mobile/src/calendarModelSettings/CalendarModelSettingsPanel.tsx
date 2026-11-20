import type { CalendarModelSettingsPanelProps } from './CalendarModelSettingsPanel.types';
import { refreshCalendarModels } from './refreshCalendarModels';
import { useCalendarModelConfirmation } from './useCalendarModelConfirmation';
import { useEffect, useRef, useState } from 'react';
import { useCalendarModelActions } from './useCalendarModelActions';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { ApiCatalogAccount } from '../providers/selection/ApiCatalogAccount';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { t } from '../i18n';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection/types';
import { ProviderSelectionChoices } from '../providers/selection/ProviderSelectionChoices';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import ProviderSelectionConfirmation from '../providers/selection/ProviderSelectionConfirmation';
import { resolveProviderSelection } from '../providers/selection/providerSelection';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
const requirements = { inputTypes: ['text'] } as const;
/** All three destinations share a separate selection, never the conversation store. */
export function CalendarModelSettingsPanel({
  options,
  chatGPTSetup,
  onBusyChange,
  onStateChange,
}: CalendarModelSettingsPanelProps) {
  const services = useModelSettingsServices();
  const { calendar: calendarModelStore, voice: voiceSettingsStore } = services;
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState<ProviderSelection | null>(null);
  const [pending, setPending] = useState<ProviderSelectionOption | null>(null);
  const [apiOptions, setApiOptions] = useState<ProviderSelectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const accountRevision = useRef<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    // A replacement owner cannot inherit the old account's catalog or draft.
    accountRevision.current = null;
    setSaved(null);
    setPending(null);
    setApiOptions([]);
    setLoading(true);
    setLoadError(false);
    setConnected(false);
    setRefreshing(false);
    setSaving(false);
    setMessage('');
    calendarModelStore
      .load()
      .then(value => {
        if (active) setSaved(value);
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setMessage(t('modelSettings.accountReadFailed'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Read only connection status, never credential contents; late account reads cannot revive old state.
    const loadAccount = async () => {
      const version = generation.current;
      try {
        const status = await voiceSettingsStore.accountStatus();
        if (active && version === generation.current)
          setConnected(status.connected);
      } catch {
        if (active && version === generation.current) setConnected(false);
      }
    };
    loadAccount();
    const unsubscribe = voiceSettingsStore.subscribe(() => {
      generation.current += 1;
      controller.current?.abort();
      accountRevision.current = null;
      setConnected(false);
      loadAccount();
      setRefreshing(false);
      setApiOptions([]);
      setPending(value =>
        value?.provider.id === 'openai-api-decisions' ? null : value,
      );
    });
    const invalidate = () => {
      generation.current += 1;
      controller.current?.abort();
    };
    return () => {
      active = false;
      invalidate();
      unsubscribe();
    };
  }, [services, calendarModelStore, voiceSettingsStore]);
  useEffect(() => {
    onBusyChange(pending !== null || saving);
    onStateChange?.(
      { hasPendingSelection: pending !== null, isSavingSelection: saving },
      true,
    );
  }, [pending, saving, onBusyChange, onStateChange]);
  const all = [...options, ...apiOptions];
  const current = all.find(
    option =>
      option.provider.id === pending?.provider.id &&
      option.modelId === pending.modelId,
  );
  const resolution = pending
    ? resolveProviderSelection(
        { providerId: pending.provider.id, modelId: pending.modelId },
        all,
        requirements,
      )
    : null;
  async function refresh() {
    if (refreshing || !connected) return;
    await refreshCalendarModels({
      services,
      generation,
      controller,
      accountRevision,
      setRefreshing,
      setApiOptions,
      setMessage,
    });
  }
  const { confirm, disclosureSheet } = useCalendarModelConfirmation({
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
  });
  const hasDock = useCalendarModelActions(
    pending !== null,
    saving,
    resolution?.ok === true && !loadError,
    confirm,
    () => setPending(null),
  );
  return (
    <View testID="calendar-model-settings">
      <ProviderSelectionChoices
        options={options}
        chatGPTSetup={chatGPTSetup}
        loading={loading || loadError}
        saving={saving}
        pendingOption={pending}
        requirements={requirements}
        presentation="settings-provider"
        selectedOption={all.find(
          option =>
            option.provider.id === saved?.providerId &&
            option.modelId === saved.modelId,
        )}
        onChoose={setPending}
      />
      <View style={styles.section} testID="calendar-model-group-openai-api">
        <Text accessibilityRole="header" style={styles.heading}>
          OpenAI API
        </Text>
        <View style={styles.catalogAccount}>
          <ApiCatalogAccount
            connected={connected}
            busy={refreshing || saving}
            refresh={() => {
              refresh();
            }}
            refreshLabel={t('modelSettings.refreshModels')}
            testIDPrefix="calendar"
            onOpenAccounts={saving ? undefined : chatGPTSetup?.onOpenAccounts}
          />
          {apiOptions.map((option, index) => (
            <ProviderSelectionOptionCard
              key={option.modelId}
              option={option}
              index={options.length + index}
              disabled={saving || loading || loadError}
              requirements={requirements}
              selected={
                (pending?.modelId ?? saved?.modelId) === option.modelId &&
                (pending?.provider.id ?? saved?.providerId) ===
                  option.provider.id
              }
              onPress={() => setPending(option)}
            />
          ))}
        </View>
      </View>
      {disclosureSheet}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      {pending ? (
        <ProviderSelectionConfirmation
          inlineConsent={false}
          hasActionDock={hasDock}
          option={current ?? pending}
          blockedMessage={
            resolution?.ok ? null : t('modelSettings.accountReadFailed')
          }
          canConfirm={resolution?.ok === true}
          saving={saving}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      ) : (
        <View style={styles.section}>
          <ModelSelectionSummary
            label={saved ? t('modelSettings.currentSelection') : undefined}
            value={saved?.modelId ?? t('modelSettings.calendarUnselected')}
            testID="calendar-current-model"
          />
        </View>
      )}
    </View>
  );
}
