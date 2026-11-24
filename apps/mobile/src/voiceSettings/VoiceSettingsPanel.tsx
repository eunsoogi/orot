import { modelPresentation } from '../providers/selection/savedModelPresentation';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import { applePrivateCloudComputeProvider } from '../providers/apple';
import { APPLE_PCC_MODEL_ID } from '../providers/selection/privateCloudCompute';
import { t } from '../i18n';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { View } from 'react-native';
import { useRef, useState, type ComponentProps } from 'react';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useVoiceSettingsRouteSave } from './useVoiceSettingsRouteSave';
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
  const [toolCanSave, setToolCanSave] = useState(false);
  const toolSave = useRef<(() => void) | null>(null);
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const liveAvailable = hasLiveVoiceRuntime();
  const { mode, model, savedModel, savedMode, busy, failedLoad, message } =
    selection;
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
  const speechTab = apiTab === 'speech';
  // One navigation action commits only the visible draft; an approval cannot apply the other pane.
  const saveDisabled = speechTab
    ? disabled || prefsBusy || toolBusy
    : !toolCanSave || busy || prefsBusy || toolBusy;
  const saveLabel = speechTab
    ? t('modelSettings.confirmVoice')
    : t('modelSettings.saveToolModel');
  const requestSave = () => {
    if (!saveDisabled) (speechTab ? confirmSave : toolSave.current)?.();
  };
  const hasDock = useVoiceSettingsRouteSave({
    active,
    label: saveLabel,
    disabled: saveDisabled,
    busy: busy || prefsBusy || toolBusy,
    onPress: requestSave,
  });
  const displayedChoice = voiceModels.find(item => item.id === model);
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
            model !== savedModel || mode !== savedMode
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
              allowedModels={catalog.fresh ? catalog.toolIds : []}
              saveRef={toolSave}
              onSaveStateChange={setToolCanSave}
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
      {active ? (
        <View style={styles.section}>
          {speechTab &&
          mode === 'openai-api' &&
          (!liveAvailable || model !== liveModel) ? (
            <Text accessibilityRole="alert">
              {t('modelSettings.liveVoiceUnavailableNoFallback')}
            </Text>
          ) : null}
          {!hasDock ? (
            <Button
              title={saveLabel}
              testID="voice-settings-save"
              disabled={saveDisabled}
              onPress={requestSave}
            />
          ) : null}
          {speechTab && prefsFailed ? (
            <Text accessibilityRole="alert">
              {t('modelSettings.liveVoicePreferenceSaveFailed')}
            </Text>
          ) : null}
          {speechTab && message ? (
            <Text accessibilityRole="alert">{message}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
