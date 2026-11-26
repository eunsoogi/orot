import { t } from '../i18n';
import { View } from 'react-native';
import { useMemo, useState, type ComponentProps } from 'react';
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
import { openAiVoicePreferencesDraftReader } from './openAiVoiceFormRead';
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { VoiceSettingsUnavailablePccOption } from './VoiceSettingsUnavailablePccOption';
import { OpenAiVoiceCatalogStatus } from './OpenAiVoiceCatalogStatus';
import { OpenAiVoiceToolOptions } from './OpenAiVoiceToolOptions';
import { OpenAiVoicePairForm } from './OpenAiVoicePairForm';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';
import { LiveVoicePreferencesPanel } from './LiveVoicePreferencesPanel';
import type { LiveVoicePreferencesDraft } from './LiveVoicePreferencesPanel';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';
import { selectOpenAiVoicePair } from './reviewOpenAiVoicePair';
import { usePreviouslyReviewedVoicePair } from './usePreviouslyReviewedVoicePair';
import { useOpenAiVoicePairSave } from './useOpenAiVoicePairSave';
import { useCanonicalLiveHealthSelection } from './useCanonicalLiveHealthSelection';
import { VoiceCurrentSelection } from './VoiceCurrentSelection';
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
  }>();
  const [preferences, setPrefs] = useState<{
    revision: number;
    draft: LiveVoicePreferencesDraft | null;
  }>();
  const [speechRevision, setSpeechRevision] = useState<number>();
  const revision = catalog.revision;
  const preferencesReader = useMemo(
    () =>
      revision === null ? null : openAiVoicePreferencesDraftReader(revision),
    [revision],
  );
  const eligible =
    revision !== null &&
    (voicePair?.runtimeAvailable ??
      (hasLiveVoiceRuntime() && hasLiveResponsesRuntime())) &&
    catalog.ids.includes(liveModel) &&
    catalog.toolIds.length > 0;
  usePreviouslyReviewedVoicePair({
    revision,
    eligible:
      active &&
      eligible &&
      catalog.fresh &&
      catalog.connected &&
      savedMode === 'openai-api' &&
      savedModel === liveModel &&
      mode === savedMode &&
      model === savedModel &&
      voice === voiceSettingsStore,
    hasDraft: speechRevision === revision || tool?.revision === revision,
    allowed: catalog.toolIds,
    restore: (owner, backend) => {
      setSpeechRevision(owner);
      setTool({ revision: owner, model: backend });
    },
  });
  const pair = selectOpenAiVoicePair({
    revision,
    fresh: catalog.fresh && eligible && catalog.connected,
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
  const companion = useCanonicalLiveHealthSelection(
    !voicePair?.commonTools &&
      active &&
      pair &&
      mode === savedMode &&
      model === savedModel
      ? { revision: pair.accountRevision, backend: pair.backendModel }
      : undefined,
    preferences?.revision === revision && preferences.draft?.dirty === true,
  );
  const saveDisabled =
    busy ||
    failedLoad ||
    pairedSave.busy ||
    companion.busy ||
    (apiDraft && !pair);
  const saveLabel = t('modelSettings.confirmVoice');
  const requestSave = () => {
    if (!saveDisabled) {
      if (companion.dirty) companion.save();
      else if (apiDraft) pairedSave.save();
      else selection.save();
    }
  };
  const hasDock = useVoiceSettingsRouteSave({
    active,
    label: saveLabel,
    disabled: saveDisabled,
    busy: busy || pairedSave.busy || companion.busy,
    onPress: requestSave,
  });
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
          selected={
            model === item.id &&
            (item.mode === 'local' || speechRevision === revision)
          }
          disabled={
            busy ||
            pairedSave.busy ||
            failedLoad ||
            (item.mode === 'openai-api' && (!eligible || !catalog.fresh))
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
  return (
    <View testID="voice-settings-panel">
      <VoiceCurrentSelection selection={selection} />
      {active
        ? (pairedSave.disclosureSheet ?? companion.disclosureSheet)
        : null}
      <View style={styles.section} testID="voice-model-group-local">
        <Text accessibilityRole="header" style={styles.heading}>
          Apple
        </Text>
        {choices('local')}
        <VoiceSettingsUnavailablePccOption />
      </View>
      <View style={styles.section} testID="voice-model-group-openai-api">
        <Text accessibilityRole="header" style={styles.heading}>
          OpenAI API
        </Text>
        <VoiceCatalogAccount catalog={catalog} onOpenAccounts={onOpenAccounts}>
          <OpenAiVoicePairForm
            fresh={active && catalog.fresh}
            eligible={eligible}
            speech={choices('openai-api')}
            preferences={
              revision !== null &&
              (livePreferences || voice === voiceSettingsStore) ? (
                <LiveVoicePreferencesPanel
                  key={revision}
                  onDraftChange={draft =>
                    setPrefs(previous =>
                      previous?.revision === revision &&
                      previous.draft === draft
                        ? previous
                        : { revision, draft },
                    )
                  }
                  busy={busy || pairedSave.busy || companion.dirty}
                  {...(livePreferences ?? {
                    ready: true,
                    store: preferencesReader!,
                    authorityRevision: revision,
                  })}
                />
              ) : null
            }
            tools={
              <OpenAiVoiceToolOptions
                companion={companion.option}
                models={catalog.toolIds}
                selected={tool?.revision === revision ? tool.model : undefined}
                disabled={busy || failedLoad || pairedSave.busy}
                choose={value => {
                  if (revision !== null) setTool({ revision, model: value });
                }}
              />
            }
          />
          <OpenAiVoiceCatalogStatus catalog={catalog} />
        </VoiceCatalogAccount>
      </View>
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
