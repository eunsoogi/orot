import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { useNextVisitQuestionsController } from './controller';
import { EvidenceCaveats } from './EvidenceCaveats';
import {
  ActionButton,
  AppointmentSection,
  ProviderSection,
} from './NextVisitComponents';
import { QuestionReviewSection } from './QuestionReviewSection';
import { SavedQuestionsSection } from './SavedQuestionsSection';
import { SourceEvidenceSheet } from './SourceEvidenceSheet';
import { createNextVisitStyles } from './styles';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestionsScreenProps,
} from './types';

/** Presents the Calendar projection while generation and persistence stay injected. */
export function NextVisitQuestionsScreen<
  TReference extends NextVisitEvidenceReference,
>(props: NextVisitQuestionsScreenProps<TReference>) {
  const styles = createNextVisitStyles(props.theme);
  const controller = useNextVisitQuestionsController(props);
  const currentAppointmentId =
    props.appointment.status === 'ready'
      ? props.appointment.appointment.id
      : null;
  // Saved questions, warnings, and load errors belong to one visit; ignore old
  // state while the next visit's list loads.
  const savedSnapshot =
    controller.savedOverride?.appointmentId === currentAppointmentId
      ? controller.savedOverride
      : props.savedQuestions.status === 'ready' &&
          props.savedQuestions.appointmentId === currentAppointmentId
        ? props.savedQuestions
        : null;
  const savedError =
    props.savedQuestions.status === 'error' &&
    props.savedQuestions.appointmentId === currentAppointmentId
      ? props.savedQuestions
      : null;
  const savedQuestions = savedSnapshot?.questions ?? [];
  const savedCaveats = savedSnapshot?.caveats ?? [];
  const savedStatus =
    currentAppointmentId === null
      ? 'hidden'
      : savedSnapshot
        ? 'ready'
        : savedError
          ? 'error'
          : 'loading';
  const savedRestorationNotice =
    savedStatus === 'ready' &&
    props.savedQuestions.status === 'ready' &&
    props.savedQuestions.appointmentId === currentAppointmentId
      ? props.savedQuestions.restorationNotice
      : undefined;
  const canGenerate =
    props.appointment.status === 'ready' &&
    props.provider.status === 'available';
  // Keep the draft visible while persistence is in flight so the user can still verify what is being retained.
  const isReviewing =
    controller.phase === 'reviewing' || controller.phase === 'saving';
  const isGenerating = controller.phase === 'generating';
  const isSaving = controller.phase === 'saving';

  const openSource = (reference: TReference) => {
    controller.openSource(reference);
    props.onOpenSource?.(reference);
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        testID="next-visit-questions-scroll"
      >
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <Text style={styles.introduction}>{copy.introduction}</Text>
        </View>

        <AppointmentSection
          appointment={props.appointment}
          onRefresh={props.onRefreshAppointment}
          theme={props.theme}
        />
        <ProviderSection
          provider={props.provider}
          onChoose={props.onOpenProviderSelection}
          theme={props.theme}
        />

        {!isReviewing ? (
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
                <ActionButton
                  label={copy.generation.cancel}
                  onPress={controller.cancelGeneration}
                  theme={props.theme}
                  variant="secondary"
                  testID="next-visit-generation-cancel"
                />
              </>
            ) : (
              <ActionButton
                disabled={!canGenerate || isSaving}
                label={
                  controller.phase === 'error'
                    ? copy.generation.retry
                    : controller.phase === 'saved'
                      ? copy.saved.generateAgain
                      : copy.generation.action
                }
                onPress={controller.generate}
                theme={props.theme}
                testID="next-visit-generate"
              />
            )}
            {controller.generationMessage ? (
              <Text
                accessibilityRole={
                  controller.phase === 'error' ? 'alert' : 'text'
                }
                style={
                  controller.phase === 'error' ? styles.error : styles.muted
                }
                testID="next-visit-generation-message"
              >
                {controller.generationMessage}
              </Text>
            ) : null}
            {controller.phase === 'saved' &&
            savedQuestions.length > 0 ? null : (
              <EvidenceCaveats
                caveats={controller.caveats}
                theme={props.theme}
              />
            )}
            {controller.saveMessage ? (
              <Text
                accessibilityRole={
                  controller.phase === 'saved' ? 'text' : 'alert'
                }
                accessibilityLiveRegion={
                  controller.phase === 'saved' ? 'polite' : 'none'
                }
                style={
                  controller.phase === 'saved' ? styles.success : styles.error
                }
                testID="next-visit-save-message"
              >
                {controller.saveMessage}
              </Text>
            ) : null}
          </View>
        ) : null}

        {isReviewing ? (
          <QuestionReviewSection
            caveats={controller.caveats}
            isReviewValid={controller.isReviewValid}
            isSaving={isSaving}
            onCancel={controller.cancelReview}
            onMove={controller.moveQuestion}
            onOpenSource={openSource}
            onRemove={controller.removeQuestion}
            onSave={controller.save}
            onUpdate={controller.updateQuestion}
            questions={controller.draftQuestions}
            saveMessage={controller.saveMessage}
            theme={props.theme}
          />
        ) : null}

        <SavedQuestionsSection
          caveats={savedCaveats}
          errorMessage={savedError?.message}
          isReviewing={isReviewing}
          onEdit={() => controller.startReview(savedQuestions, savedCaveats)}
          onOpenSource={openSource}
          onRetry={props.onRetrySavedQuestions}
          questions={savedQuestions}
          restorationNotice={savedRestorationNotice}
          status={savedStatus}
          theme={props.theme}
        />
      </ScrollView>
      <SourceEvidenceSheet
        onClose={controller.closeSource}
        reference={controller.sourceReference}
        theme={props.theme}
      />
    </>
  );
}
