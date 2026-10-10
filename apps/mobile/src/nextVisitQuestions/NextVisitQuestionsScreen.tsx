import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { useNextVisitQuestionsController } from './controller';
import { QuestionReviewActions } from './QuestionReviewActions';
import { useRouteStatePublisher } from './useRouteStatePublisher';
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
import { savedVisitPresentation } from './savedVisitPresentation';
import { useNextVisitPrimaryAction } from './useNextVisitPrimaryAction';
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
  useRouteStatePublisher({
    appointmentId: currentAppointmentId,
    phase: controller.phase,
    draftQuestions: controller.draftQuestions,
    hasUnsavedChanges: controller.hasUnsavedChanges,
    onRouteStateChange: props.onRouteStateChange,
  });
  const {
    savedQuestions,
    savedCaveats,
    savedError,
    savedStatus,
    savedRestorationNotice,
  } = savedVisitPresentation(
    currentAppointmentId,
    props.savedQuestions,
    controller.savedOverride,
  );
  const canGenerate =
    props.appointment.status === 'ready' &&
    props.provider.status === 'available';
  const {
    isReviewing,
    isGenerating,
    isSaving,
    generateLabel,
    hasSharedAction,
  } = useNextVisitPrimaryAction(controller, canGenerate);

  const openSource = (reference: TReference) => {
    controller.openSource(reference);
    props.onOpenSource?.(reference);
  };

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <ScrollView
          // Keep the edited list scrollable, and dismiss the keyboard on drag.
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.container}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={styles.fill}
          testID="next-visit-questions-scroll"
        >
          <View>
            <Text accessibilityRole="header" style={styles.title}>
              {isReviewing ? copy.review.heading : copy.title}
            </Text>
            <Text style={styles.introduction}>
              {isReviewing ? copy.review.helper : copy.introduction}
            </Text>
          </View>

          {!isReviewing ? (
            <AppointmentSection
              appointment={props.appointment}
              onRefresh={props.onRefreshAppointment}
              theme={props.theme}
            />
          ) : null}
          {!isReviewing ? (
            <ProviderSection
              provider={props.provider}
              onChoose={props.onOpenProviderSelection}
              theme={props.theme}
            />
          ) : null}

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
                  {!hasSharedAction ? (
                    <ActionButton
                      label={copy.generation.cancel}
                      onPress={controller.cancelGeneration}
                      theme={props.theme}
                      variant="secondary"
                      testID="next-visit-generation-cancel"
                    />
                  ) : null}
                </>
              ) : !hasSharedAction ? (
                <ActionButton
                  disabled={!canGenerate || isSaving}
                  label={generateLabel}
                  onPress={controller.generate}
                  theme={props.theme}
                  testID="next-visit-generate"
                />
              ) : null}
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

          {isReviewing && hasSharedAction ? (
            <ActionButton
              disabled={isSaving}
              label={copy.review.cancel}
              onPress={controller.cancelReview}
              theme={props.theme}
              variant="secondary"
              testID="next-visit-review-cancel"
            />
          ) : null}
          {isReviewing ? (
            <QuestionReviewSection
              caveats={controller.caveats}
              isSaving={isSaving}
              onMove={controller.moveQuestion}
              onOpenSource={openSource}
              onRemove={controller.removeQuestion}
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
        {isReviewing && !hasSharedAction ? (
          <QuestionReviewActions
            isReviewValid={controller.isReviewValid}
            isSaving={isSaving}
            onCancel={controller.cancelReview}
            onSave={controller.save}
            theme={props.theme}
          />
        ) : null}
      </KeyboardAvoidingView>
      <SourceEvidenceSheet
        onClose={controller.closeSource}
        reference={controller.sourceReference}
        theme={props.theme}
      />
    </>
  );
}
