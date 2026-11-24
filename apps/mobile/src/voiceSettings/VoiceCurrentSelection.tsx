import { t } from '../i18n';
import { modelPresentation } from '../providers/selection/savedModelPresentation';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { AppText as Text } from '../layout/AppText';
import type { useVoiceSelection } from './useVoiceSelection';
import { voiceModels } from './voiceModels';

export function VoiceCurrentSelection({
  selection,
}: {
  readonly selection: Pick<
    ReturnType<typeof useVoiceSelection>,
    | 'pairAwaitingActivation'
    | 'savedModel'
    | 'savedMode'
    | 'model'
    | 'mode'
    | 'failedLoad'
  >;
}) {
  const {
    pairAwaitingActivation,
    savedModel,
    savedMode,
    model,
    mode,
    failedLoad,
  } = selection;
  if (pairAwaitingActivation) {
    return (
      <Text accessibilityRole="alert">
        {t('modelSettings.liveVoicePairRecovery')}
      </Text>
    );
  }
  if (savedModel === null || failedLoad) return null;
  const displayedChoice = voiceModels.find(item => item.id === model);
  return (
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
  );
}
