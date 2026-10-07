import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import { useNextVisitQuestionsController } from './controller';
import { EvidenceCaveats } from './EvidenceCaveats';
import {
  ActionButton,
  AppointmentSection,
  ProviderSection,
} from './NextVisitComponents';
import { QuestionCard } from './QuestionCard';
import { QuestionReviewSection } from './QuestionReviewSection';
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
  const savedQuestions =
    controller.savedOverride ?? props.savedQuestions.questions;
  const savedStatus = controller.savedOverride
    ? 'ready'
    : props.savedQuestions.status;
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
            <EvidenceCaveats caveats={controller.caveats} theme={props.theme} />
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

        {savedStatus === 'loading' ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.muted}
            testID="next-visit-saved-loading"
          >
            {copy.saved.loading}
          </Text>
        ) : savedStatus === 'error' ? (
          <View style={styles.section}>
            <Text
              accessibilityRole="alert"
              style={styles.error}
              testID="next-visit-saved-error"
            >
              {props.savedQuestions.status === 'error'
                ? (props.savedQuestions.message ?? copy.saved.error)
                : copy.saved.error}
            </Text>
            <ActionButton
              label={copy.saved.retry}
              onPress={props.onRetrySavedQuestions}
              theme={props.theme}
              variant="secondary"
              testID="next-visit-saved-retry"
            />
          </View>
        ) : savedQuestions.length > 0 && !isReviewing ? (
          <View style={styles.section} testID="next-visit-saved-list">
            <Text accessibilityRole="header" style={styles.sectionHeading}>
              {copy.saved.heading}
            </Text>
            {savedQuestions.map((question, index) => (
              <QuestionCard
                count={savedQuestions.length}
                editable={false}
                index={index}
                key={`saved-${index}`}
                onMove={() => undefined}
                onOpenSource={openSource}
                onRemove={() => undefined}
                onUpdate={() => undefined}
                question={question}
                theme={props.theme}
                disabled={false}
              />
            ))}
            <ActionButton
              label={copy.saved.edit}
              onPress={() => controller.startReview(savedQuestions)}
              theme={props.theme}
              variant="secondary"
              testID="next-visit-saved-edit"
            />
          </View>
        ) : savedStatus === 'ready' && !isReviewing ? (
          <Text style={styles.muted} testID="next-visit-saved-empty">
            {copy.saved.empty}
          </Text>
        ) : null}
      </ScrollView>
      <SourceEvidenceSheet
        onClose={controller.closeSource}
        reference={controller.sourceReference}
        theme={props.theme}
      />
    </>
  );
}
