import { t } from '../i18n';
import { View } from 'react-native';
import { useState, type ComponentProps } from 'react';
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
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { VoiceModelGroups } from './VoiceModelGroups';
import { OpenAiVoiceToolOptions } from './OpenAiVoiceToolOptions';
import { OpenAiVoicePairForm } from './OpenAiVoicePairForm';
import { LiveVoicePreferencesPanel } from './LiveVoicePreferencesPanel';
import type { LiveVoicePreferencesDraft } from './LiveVoicePreferencesPanel';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';
import { selectOpenAiVoicePair } from './reviewOpenAiVoicePair';
import { usePreviouslyReviewedVoicePair } from './usePreviouslyReviewedVoicePair';
import { VoicePairPreferences } from './VoicePairPreferences';
import type { LiveResponsesSettings } from './liveResponsesSettings';
import { useOpenAiVoicePairSave } from './useOpenAiVoicePairSave';
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
  const { voice, voicePair } = useModelSettingsServices();
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const { mode, model, savedModel, savedMode, busy, failedLoad, message } =
    selection;
  const [tool, setTool] = useState<{
    revision: number;
    model: LiveResponsesBackend;
    restored?: Extract<LiveResponsesSettings, { kind: 'active' }>;
  }>();
  const [preferences, setPrefs] = useState<{
    revision: number;
    draft: LiveVoicePreferencesDraft | null;
  }>();
  const [speechRevision, setSpeechRevision] = useState<number>();
  const revision = catalog.revision;
  const knownPair =
    catalog.ids.includes(liveModel) && catalog.toolIds.length > 0;
  const eligible =
    revision !== null &&
    (voicePair?.runtimeAvailable ??
      (hasLiveVoiceRuntime() && hasLiveResponsesRuntime())) &&
    knownPair;
  const apiSelectable = catalog.fresh && eligible && catalog.connected;
  // A legacy installation may have an exact authorized pair but no catalog
  // cache yet. Show just that proven pair, never use it as fresh availability.
  const allowSavedPreview =
    !catalog.fresh && !catalog.ids.length && !catalog.toolIds.length;
  const preview =
    allowSavedPreview &&
    catalog.connected &&
    !selection.pairAwaitingActivation &&
    savedMode === 'openai-api' &&
    mode === savedMode &&
    savedModel === liveModel &&
    tool?.revision === revision &&
    tool.restored
      ? tool.model
      : undefined;
  usePreviouslyReviewedVoicePair({
    revision,
    eligible:
      active &&
      (knownPair || allowSavedPreview) &&
      catalog.connected &&
      !selection.pairAwaitingActivation &&
      savedMode === 'openai-api' &&
      savedModel === liveModel &&
      mode === savedMode &&
      model === savedModel &&
      voice === voiceSettingsStore,
    hasDraft: speechRevision === revision || tool?.revision === revision,
    allowed: catalog.toolIds,
    allowSavedPreview,
    restore: (owner, restored) => {
      setSpeechRevision(owner);
      setTool({
        revision: owner,
        model: restored.nativeGrant.backendModel,
        restored,
      });
    },
  });
  const pair = selectOpenAiVoicePair({
    revision,
    fresh: apiSelectable,
    speechIds: catalog.ids,
    toolIds: catalog.toolIds,
    speechModel:
      mode === 'openai-api' && speechRevision === revision ? model : undefined,
    backendModel: tool?.revision === revision ? tool.model : undefined,
  });
  const apiDraft =
    mode === 'openai-api' || (revision !== null && tool?.revision === revision);
  const pairedSave = useOpenAiVoicePairSave({
    active: active && !failedLoad && !busy,
    pair,
    commonTools: voicePair?.commonTools,
    commit: voicePair?.commit,
    preferences:
      preferences?.revision === revision
        ? preferences.draft?.preferences
        : undefined,
    onSaved: value => selection.markPairSaved(value.speechModel),
    onUnavailable: selection.markPairUnavailable,
  });
  const saveDisabled =
    busy || failedLoad || pairedSave.busy || (apiDraft && !pair);
  const saveLabel = t('modelSettings.confirmVoice');
  const requestSave = () => {
    if (!saveDisabled) {
      if (apiDraft) pairedSave.save();
      else selection.save();
    }
  };
  const hasDock = useVoiceSettingsRouteSave({
    active,
    label: saveLabel,
    disabled: saveDisabled,
    busy: busy || pairedSave.busy,
    onPress: requestSave,
  });
  const choices = (connection: 'local' | 'openai-api') =>
    voiceModels
      .filter(
        item =>
          item.mode === connection &&
          (item.mode === 'local' ||
            catalog.ids.includes(item.id) ||
            (preview && item.id === liveModel)),
      )
      .map(item => (
        <VoiceModelOption
          key={item.id}
          item={item}
          selected={
            model === item.id &&
            (item.mode === 'local' || speechRevision === revision)
          }
          disabled={
            busy ||
            pairedSave.busy ||
            failedLoad ||
            (item.mode === 'openai-api' && !apiSelectable)
          }
          onPress={() => {
            if (item.mode === 'openai-api' && revision !== null)
              setSpeechRevision(revision);
            else if (item.mode === 'local') {
              setSpeechRevision(undefined);
              setTool(undefined);
            }
            selection.choose(item.mode, item.id);
          }}
        />
      ));
  const apiOptions = (
    <OpenAiVoicePairForm
      visible={
        active && catalog.connected && (knownPair || preview !== undefined)
      }
      speech={choices('openai-api')}
      preferences={
        revision === null ? null : (
          <VoicePairPreferences
            revision={revision}
            saved={
              mode === savedMode && tool?.revision === revision
                ? tool.restored
                : undefined
            }
            editable={
              apiSelectable &&
              !!(livePreferences || voice === voiceSettingsStore)
            }
            cached={!catalog.fresh}
            busy={busy || pairedSave.busy}
            override={livePreferences}
            onDraftChange={draft => setPrefs({ revision, draft })}
          />
        )
      }
      tools={
        <OpenAiVoiceToolOptions
          models={preview ? [preview] : catalog.toolIds}
          selected={tool?.revision === revision ? tool.model : undefined}
          disabled={
            busy || failedLoad || pairedSave.busy || !catalog.fresh || !eligible
          }
          choose={value => {
            if (revision !== null) setTool({ revision, model: value });
          }}
        />
      }
    />
  );
  return (
    <View testID="voice-settings-panel">
      {selection.pairAwaitingActivation ? (
        <Text accessibilityRole="alert">
          {t('modelSettings.liveVoicePairRecovery')}
        </Text>
      ) : null}
      {active ? pairedSave.disclosureSheet : null}
      <VoiceModelGroups
        api={apiOptions}
        catalog={catalog}
        onOpenAccounts={onOpenAccounts}
        apiFirst={savedMode === 'openai-api'}
        local={choices('local')}
      />
      {active ? (
        <View style={styles.section}>
          {!hasDock ? (
            <Button
              title={saveLabel}
              testID="voice-settings-save"
              disabled={saveDisabled}
              onPress={requestSave}
            />
          ) : null}
          {pairedSave.error || message ? (
            <Text accessibilityRole="alert">{pairedSave.error || message}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
