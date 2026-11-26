import { t } from '../i18n';
import { ProviderModelChoiceRow } from '../providers/selection/ProviderModelChoiceRow';
import { savedChatGPTModelLabel } from '../providers/selection/knownChatGPTModelLabel';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';

/** Share Conversation's title and ID presentation without changing Voice eligibility. */
export function OpenAiVoiceToolOptions({
  models,
  selected,
  disabled,
  choose,
}: {
  models: readonly LiveResponsesBackend[];
  selected: LiveResponsesBackend | undefined;
  disabled: boolean;
  choose: (model: LiveResponsesBackend) => void;
}) {
  return (
    <>
      {models.map(model => (
        <ProviderModelChoiceRow
          key={model}
          testID={`voice-tool-model-${model}`}
          title={
            savedChatGPTModelLabel(model) ?? t('modelSettings.modelNameUnknown')
          }
          detail={model}
          icon="wrench.and.screwdriver"
          selected={selected === model}
          disabled={disabled}
          onPress={() => choose(model)}
        />
      ))}
    </>
  );
}
