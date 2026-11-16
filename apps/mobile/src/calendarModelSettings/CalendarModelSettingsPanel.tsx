import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection/types';
import { ProviderSelectionChoices } from '../providers/selection/ProviderSelectionChoices';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import ProviderSelectionConfirmation from '../providers/selection/ProviderSelectionConfirmation';
import { resolveProviderSelection } from '../providers/selection/providerSelection';
import { calendarModelStore } from './calendarModelStore';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { createCalendarDecisionsOption } from './decisionsProvider';

const requirements = { inputTypes: ['text'] } as const;
/** All three destinations share a separate selection, never the conversation store. */
export function CalendarModelSettingsPanel({
  options,
  chatGPTSetup,
  onBusyChange,
  onStateChange,
}: {
  readonly options: readonly ProviderSelectionOption[];
  readonly chatGPTSetup?: ChatGPTAccountSetup;
  readonly onStateChange?: (
    state: { hasPendingSelection: boolean; isSavingSelection: boolean },
    inputChanged?: boolean,
  ) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
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
    const unsubscribe = voiceSettingsStore.subscribe(() => {
      generation.current += 1;
      controller.current?.abort();
      accountRevision.current = null;
      setRefreshing(false);
      setApiOptions([]);
      setPending(value =>
        value?.provider.id === 'openai-api-decisions' ? null : value,
      );
    });
    return () => {
      active = false;
      generation.current += 1;
      controller.current?.abort();
      unsubscribe();
    };
  }, []);
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
    if (refreshing) return;
    const request = ++generation.current;
    controller.current?.abort();
    setRefreshing(true);
    setApiOptions([]);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await voiceSettingsStore.discoverModels(abort.signal);
      if (request !== generation.current || abort.signal.aborted) return;
      accountRevision.current = result.revision;
      const supported = result.ids.filter(id => id === 'gpt-6-luna');
      setApiOptions(
        supported.map(id => createCalendarDecisionsOption(id, result.revision)),
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
  async function confirm() {
    if (!pending || !current || resolution?.ok !== true || saving || loadError)
      return;
    setSaving(true);
    try {
      if (current.provider.id === 'openai-api-decisions') {
        const account = await voiceSettingsStore.accountStatus();
        if (!account.connected || account.revision !== accountRevision.current)
          throw new Error('Account unavailable');
      }
      const selection = {
        providerId: current.provider.id,
        modelId: current.modelId,
      };
      await calendarModelStore.save(selection);
      setSaved(selection);
      setPending(null);
      setMessage('');
    } catch {
      setMessage(t('modelSettings.accountReadFailed'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <View testID="calendar-model-settings">
      <Text>{t('modelSettings.calendarPurpose')}</Text>
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
      <Text accessibilityRole="header">OpenAI API</Text>
      <Text>{t('modelSettings.decisionsNotice')}</Text>
      {chatGPTSetup?.onOpenAccounts ? (
        <Button
          title={t('modelSettings.registerApiKey')}
          onPress={chatGPTSetup.onOpenAccounts}
          disabled={saving}
        />
      ) : null}
      <Button
        title={t('modelSettings.refreshAccountModels')}
        onPress={refresh}
        disabled={refreshing || saving}
        testID="calendar-model-refresh"
      />
      {apiOptions.map((option, index) => (
        <ProviderSelectionOptionCard
          key={option.modelId}
          option={option}
          index={options.length + index}
          disabled={saving || loading || loadError}
          requirements={requirements}
          showCapabilities={false}
          selected={
            (pending?.modelId ?? saved?.modelId) === option.modelId &&
            (pending?.provider.id ?? saved?.providerId) === option.provider.id
          }
          onPress={() => setPending(option)}
        />
      ))}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      {pending ? (
        <ProviderSelectionConfirmation
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
        <Text>{saved?.modelId ?? t('modelSettings.calendarUnselected')}</Text>
      )}
    </View>
  );
}
