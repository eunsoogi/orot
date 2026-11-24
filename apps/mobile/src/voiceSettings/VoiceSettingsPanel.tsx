import { modelPresentation } from '../providers/selection/savedModelPresentation';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import { applePrivateCloudComputeProvider } from '../providers/apple';
import { APPLE_PCC_MODEL_ID } from '../providers/selection/privateCloudCompute';
import { t } from '../i18n';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { View } from 'react-native';
import { useState, type ComponentProps } from 'react';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useVoiceCatalog } from './useVoiceCatalog';
import { useVoiceSelection } from './useVoiceSelection';
import {
  hasLiveResponsesRuntime,
  hasLiveVoiceRuntime,
} from './voiceRuntimeCapability';
import { liveModel } from './liveVoicePreferences';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { voiceSettingsStore } from './voiceSettingsStore';
import { liveVoicePreferencesKeychain } from './liveVoicePreferencesKeychain';
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { OpenAiVoiceModelSection } from './OpenAiVoiceModelSection';
import type { OpenAiVoiceModelTab } from './OpenAiVoiceModelTabs';
import { LiveVoicePreferencesPanel } from './LiveVoicePreferencesPanel';
import { LiveResponsesSettingsPanel } from './LiveResponsesSettingsPanel';
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
  const [apiTab, setApiTab] = useState<OpenAiVoiceModelTab>('speech');
  const [toolBusy, setToolBusy] = useState(false);
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const liveAvailable = hasLiveVoiceRuntime();
  const { mode, model, savedModel, savedMode, busy, failedLoad, message } =
    selection;
  const toolModels =
    mode === savedMode && model === savedModel && !busy && catalog.fresh
      ? catalog.toolIds
      : [];
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
    active: active && apiTab === 'speech',
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
    confirmSave();
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
    active && apiTab === 'speech',
  );
  const displayedChoice = voiceModels.find(
    item => item.mode === mode && item.id === model,
  );
  const showingDraft = model !== savedModel || mode !== savedMode;
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
            toolBusy ||
            failedLoad ||
            (item.mode === 'openai-api' && (!liveAvailable || !catalog.fresh))
          }
          onPress={() => {
            if (item.mode === 'local') setApiTab('speech');
            selection.choose(item.mode, item.id);
          }}
        />
      ));
  return (
    <View testID="voice-settings-panel">
      {savedModel !== null && !failedLoad ? (
        <ModelSelectionSummary
          label={t(
            showingDraft
              ? 'modelSettings.selectedAiPrefix'
              : 'modelSettings.currentSelection',
          )}
          value={modelPresentation(
            mode === 'local' ? 'Apple' : 'OpenAI API',
            displayedChoice?.title,
          )}
          testID="voice-current-model"
        />
      ) : null}
      {active && apiTab === 'speech' ? disclosureSheet : null}
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
      <OpenAiVoiceModelSection
        catalog={catalog}
        onOpenAccounts={onOpenAccounts}
        selected={apiTab}
        onSelect={setApiTab}
        disabled={busy || prefsBusy || toolBusy}
        speech={
          <>
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
          </>
        }
        tools={
          active &&
          !failedLoad &&
          voice === voiceSettingsStore &&
          savedMode === 'openai-api' &&
          savedModel === liveModel &&
          catalog.connected &&
          catalog.revision !== null &&
          hasLiveResponsesRuntime() ? (
            <LiveResponsesSettingsPanel
              key={catalog.revision}
              active={apiTab === 'tools'}
              onBusyChange={setToolBusy}
              ownerRevision={catalog.revision}
              allowedModels={toolModels}
            />
          ) : (
            <Text style={styles.detail}>
              {t(
                savedMode === 'openai-api' && savedModel === liveModel
                  ? 'modelSettings.liveResponsesUnavailable'
                  : 'modelSettings.liveResponsesSelectVoice',
              )}
            </Text>
          )
        }
      />
      {active && apiTab === 'speech' ? (
        <View style={styles.section}>
          {mode === 'openai-api' && (!liveAvailable || model !== liveModel) ? (
            <Text accessibilityRole="alert">
              {t('modelSettings.liveVoiceUnavailableNoFallback')}
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
            <Text accessibilityRole="alert">
              {t('modelSettings.liveVoicePreferenceSaveFailed')}
            </Text>
          ) : null}
          {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
