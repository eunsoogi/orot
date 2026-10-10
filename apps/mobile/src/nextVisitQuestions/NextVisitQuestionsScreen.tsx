import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import {
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
import { NextVisitGenerationSection } from './NextVisitGenerationSection';
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
  const navigationInset = useNavigationContentInset();
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
  } = useNextVisitPrimaryAction(
    controller,
    canGenerate,
    savedQuestions.length > 0
      ? () => controller.startReview(savedQuestions, savedCaveats)
      : null,
  );

  const openSource = (reference: TReference) => {
    controller.openSource(reference);
    props.onOpenSource?.(reference);
  };

  return (
    <>
      <KeyboardAvoidingView
        // The shared shell moves both the page and toolbar; standalone use owns its keyboard inset here.
        enabled={!hasSharedAction}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <ScrollView
          // Keep the edited list scrollable, and dismiss the keyboard on drag.
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.container, navigationInset]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={styles.fill}
          testID="next-visit-questions-scroll"
        >
          <View>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="next-visit-title"
            >
              {isReviewing ? copy.review.heading : copy.title}
            </Text>
            {!isReviewing ? (
              <Text style={styles.introduction}>
                {savedQuestions.length > 0
                  ? copy.saved.introduction
                  : copy.introduction}
              </Text>
            ) : null}
          </View>

          <AppointmentSection
            appointment={props.appointment}
            onRefresh={props.onRefreshAppointment}
            theme={props.theme}
          />
          {!isReviewing ? (
            <ProviderSection
              provider={props.provider}
              onChoose={props.onOpenProviderSelection}
              theme={props.theme}
            />
          ) : null}

          {!isReviewing ? (
            <NextVisitGenerationSection
              controller={controller}
              theme={props.theme}
              isGenerating={isGenerating}
              isSaving={isSaving}
              hasSharedAction={hasSharedAction}
              canGenerate={canGenerate}
              generateLabel={generateLabel}
              hasSavedQuestions={savedQuestions.length > 0}
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
          <SavedQuestionsSection
            caveats={savedCaveats}
            errorMessage={savedError?.message}
            isReviewing={isReviewing}
            hasSharedAction={hasSharedAction}
            onEdit={() => controller.startReview(savedQuestions, savedCaveats)}
            onOpenSource={openSource}
            onRetry={props.onRetrySavedQuestions}
            questions={savedQuestions}
            restorationNotice={savedRestorationNotice}
            status={savedStatus}
            theme={props.theme}
          />
          {!isReviewing && savedQuestions.length > 0 && !isGenerating ? (
            <ActionButton
              disabled={!canGenerate}
              label={copy.saved.generateAgain}
              onPress={controller.generate}
              theme={props.theme}
              variant="link"
              testID="next-visit-generate"
            />
          ) : null}
          {!isReviewing &&
          controller.phase === 'saved' &&
          controller.saveMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.muted}
              testID="next-visit-save-message"
            >
              {controller.saveMessage}
            </Text>
          ) : null}
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
