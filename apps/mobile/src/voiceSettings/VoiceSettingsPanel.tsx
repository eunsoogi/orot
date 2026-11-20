import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import { applePrivateCloudComputeProvider } from '../providers/apple';
import { APPLE_PCC_MODEL_ID } from '../providers/selection/privateCloudCompute';
import { t } from '../i18n';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { View } from 'react-native';
import type { ComponentProps } from 'react';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useVoiceCatalog } from './useVoiceCatalog';
import { useVoiceSelection } from './useVoiceSelection';
import { hasLiveVoiceRuntime } from './voiceRuntimeCapability';
import { liveModel } from './liveVoicePreferences';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { voiceSettingsStore } from './voiceSettingsStore';
import { liveVoicePreferencesKeychain } from './liveVoicePreferencesKeychain';
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';
import { LiveVoicePreferencesPanel } from './LiveVoicePreferencesPanel';
import { useLiveVoiceSettingsSave } from './useLiveVoiceSettingsSave';

/** Local and API providers are sibling sections; a hidden tab must not own navigation actions. */
export function VoiceSettingsPanel({
  onOpenAccounts,
  active = true,
  livePreferences,
}: {
  readonly onOpenAccounts?: () => void;
  readonly active?: boolean;
  readonly livePreferences?: ComponentProps<typeof LiveVoicePreferencesPanel>;
}) {
  const { voice } = useModelSettingsServices();
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const liveAvailable = hasLiveVoiceRuntime();
  const { mode, model, savedModel, busy, failedLoad, message } = selection;
  const canApproveNew = catalog.fresh && catalog.ids.includes(model);
  const disabled =
    busy ||
    failedLoad ||
    (mode === 'openai-api' &&
      (!liveAvailable ||
        model !== liveModel ||
        !catalog.connected ||
        (!canApproveNew && savedModel !== model)));
  const {
    confirmSave,
    setPrefs,
    prefsBusy,
    prefsFailed,
    saveRevision,
    disclosureSheet,
  } = useLiveVoiceSettingsSave({
    active,
    disabled,
    canApproveNew,
    mode,
    model,
    savedModel,
    revision: catalog.revision,
    save: selection.save,
    store: livePreferences?.store ?? liveVoicePreferencesKeychain,
  });
  const requestSave = () => {
    void confirmSave();
  };
  const hasDock = useNavigationRouteActions(
    [
      {
        id: 'confirm-voice-model',
        label: t('modelSettings.confirmVoice'),
        accessibilityLabel: t('modelSettings.confirmVoice'),
        testID: 'voice-settings-save',
        systemImageName: 'checkmark',
        disabled: disabled || prefsBusy,
        busy: busy || prefsBusy,
        onPress: requestSave,
      },
    ],
    active,
  );
  const choices = (connection: 'local' | 'openai-api') =>
    voiceModels
      .filter(
        item =>
          item.mode === connection &&
          (item.mode === 'local' || catalog.ids.includes(item.id)),
      )
      .map(item => (
        <VoiceModelOption
          key={item.id}
          item={item}
          selected={model === item.id}
          disabled={
            busy ||
            failedLoad ||
            (item.mode === 'openai-api' && (!liveAvailable || !catalog.fresh))
          }
          onPress={() => selection.choose(item.mode, item.id)}
        />
      ));
  return (
    <View testID="voice-settings-panel">
      {active ? disclosureSheet : null}
      <View style={styles.section} testID="voice-model-group-local">
        <Text accessibilityRole="header" style={styles.heading}>
          Apple
        </Text>
        {choices('local')}
        {/* Display-only: PCC has no voice runtime and must never enter voiceModels or save. */}
        <ProviderSelectionOptionCard
          option={{
            provider: applePrivateCloudComputeProvider,
            modelId: APPLE_PCC_MODEL_ID,
            displayName: 'Apple Intelligence',
            privacyBoundary: 'selected-context-remote',
            availability: {
              status: 'unavailable',
              message: t('provider.pcc.entitlementRequired'),
            },
          }}
          requirements={{ inputTypes: ['text'] }}
          disabled
          selected={false}
          index={0}
          onPress={() => undefined}
        />
      </View>
      <View style={styles.section} testID="voice-model-group-openai-api">
        <Text accessibilityRole="header" style={styles.heading}>
          OpenAI API
        </Text>
        <View style={styles.catalogAccount}>
          <VoiceCatalogAccount
            catalog={catalog}
            onOpenAccounts={onOpenAccounts}
          />
          {choices('openai-api')}
          {active &&
          !failedLoad &&
          mode === 'openai-api' &&
          model === liveModel &&
          liveAvailable &&
          (livePreferences ||
            (voice === voiceSettingsStore &&
              catalog.connected &&
              catalog.revision !== null)) ? (
            <LiveVoicePreferencesPanel
              onDraftChange={setPrefs}
              busy={busy || prefsBusy}
              saveRevision={saveRevision}
              {...(livePreferences ?? {
                ready: true,
                store: liveVoicePreferencesKeychain,
                authorityRevision: catalog.revision!,
              })}
            />
          ) : null}
        </View>
        {catalog.message &&
        catalog.message !== t('modelSettings.refreshAccountModels') ? (
          <Text accessibilityRole="status" style={styles.secondary}>
            {catalog.message}
          </Text>
        ) : null}
        {!catalog.fresh && catalog.ids.length > 0 ? (
          <Text style={styles.detail}>{t('modelSettings.staleModels')}</Text>
        ) : null}
      </View>
      <View style={styles.section}>
        {!busy && !failedLoad ? (
          <ModelSelectionSummary
            label={t('modelSettings.currentSelection')}
            value={
              voiceModels.find(item => item.id === savedModel)?.title ??
              (savedModel ? '기존 OpenAI 음성 설정 (전환 필요)' : '')
            }
            testID="voice-current-model"
          />
        ) : null}
        {mode === 'openai-api' && (!liveAvailable || model !== liveModel) ? (
          <Text accessibilityRole="alert">
            GPT-Live-1.1로 연결할 수 없어요. 기존 음성 모델로 자동 전환하지
            않아요.
          </Text>
        ) : null}
        {!hasDock && active ? (
          <Button
            title={t('modelSettings.confirmVoice')}
            testID="voice-settings-save"
            disabled={disabled || prefsBusy}
            onPress={requestSave}
          />
        ) : null}
        {prefsFailed ? (
          <Text accessibilityRole="alert">음성 설정을 저장하지 못했어요.</Text>
        ) : null}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
    </View>
  );
}
