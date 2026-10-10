import { ActivityIndicator, Text, View } from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { ActionButton } from './NextVisitComponents';
import { EvidenceCaveats } from './EvidenceCaveats';
import { createNextVisitStyles } from './styles';
import type { NextVisitQuestionsController } from './controllerTypes';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestionsTheme,
} from './types';

/** Generation and save feedback remain visible without taking over the saved-list action. */
export function NextVisitGenerationSection<
  T extends NextVisitEvidenceReference,
>({
  controller,
  theme,
  isGenerating,
  isSaving,
  hasSharedAction,
  canGenerate,
  generateLabel,
  hasSavedQuestions,
}: {
  readonly controller: NextVisitQuestionsController<T>;
  readonly theme: NextVisitQuestionsTheme;
  readonly isGenerating: boolean;
  readonly isSaving: boolean;
  readonly hasSharedAction: boolean;
  readonly canGenerate: boolean;
  readonly generateLabel: string;
  readonly hasSavedQuestions: boolean;
}) {
  const styles = createNextVisitStyles(theme);
  if (
    !isGenerating &&
    hasSharedAction &&
    !controller.generationMessage &&
    (!controller.saveMessage || controller.phase === 'saved') &&
    (controller.caveats.length === 0 || controller.phase === 'saved')
  )
    return null;
  return (
    <View style={styles.section}>
      {isGenerating ? (
        <>
          <ActivityIndicator
            accessibilityLabel={copy.generation.loading}
            testID="next-visit-generation-loading"
          />
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {copy.generation.loading}
          </Text>
          {!hasSharedAction ? (
            <ActionButton
              label={copy.generation.cancel}
              onPress={controller.cancelGeneration}
              theme={theme}
              variant="secondary"
              testID="next-visit-generation-cancel"
            />
          ) : null}
        </>
      ) : !hasSharedAction && !hasSavedQuestions ? (
        <ActionButton
          disabled={!canGenerate || isSaving}
          label={generateLabel}
          onPress={controller.generate}
          theme={theme}
          testID="next-visit-generate"
        />
      ) : null}
      {controller.generationMessage ? (
        <Text
          accessibilityRole={controller.phase === 'error' ? 'alert' : 'text'}
          style={controller.phase === 'error' ? styles.error : styles.muted}
          testID="next-visit-generation-message"
        >
          {controller.generationMessage}
        </Text>
      ) : null}
      {controller.phase === 'saved' && hasSavedQuestions ? null : (
        <EvidenceCaveats caveats={controller.caveats} theme={theme} />
      )}
      {controller.saveMessage && controller.phase !== 'saved' ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="next-visit-save-message"
        >
          {controller.saveMessage}
        </Text>
      ) : null}
    </View>
  );
}
