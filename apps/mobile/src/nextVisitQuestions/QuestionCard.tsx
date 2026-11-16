import { t } from '../i18n';
import { ActionButton } from './QuestionCardActionButton';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { QuestionPriorityControl } from './QuestionPriorityControl';
import { nextVisitQuestionsCopy as copy } from './copy';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsTheme,
} from './types';
import { createQuestionCardStyles } from './questionCardStyles';

interface QuestionCardProps<TReference extends NextVisitEvidenceReference> {
  readonly question: NextVisitQuestion<TReference>;
  readonly selectionHeader?: ReactNode;
  readonly priorityInDetails?: boolean;
  readonly compact?: boolean;
  readonly index: number;
  readonly count: number;
  readonly editable: boolean;
  readonly disabled: boolean;
  readonly theme: NextVisitQuestionsTheme;
  readonly onUpdate: (
    update: Partial<
      Pick<
        NextVisitQuestion<TReference>,
        'questionText' | 'rationale' | 'priority'
      >
    >,
  ) => void;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onOpenSource: (reference: TReference) => void;
}

/** Keeps evidence read-only while the person edits the question and its wording. */
export function QuestionCard<TReference extends NextVisitEvidenceReference>({
  question,
  selectionHeader,
  priorityInDetails = false,
  compact = false,
  index,
  count,
  editable,
  disabled,
  theme,
  onUpdate,
  onMove,
  onRemove,
  onOpenSource,
}: QuestionCardProps<TReference>) {
  const styles = createQuestionCardStyles(theme, compact);
  const number = index + 1;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <View style={styles.card} testID={`next-visit-question-${index}`}>
      <View style={styles.headingRow}>
        {selectionHeader}
        {!selectionHeader ? (
          <View style={styles.numberBadge}>
            <Text style={styles.heading}>{number}</Text>
          </View>
        ) : null}
        {editable ? (
          <TextInput
            // UIKit can retain attributed text colors across appearance changes; draft state stays in the controller.
            key={`question-${theme.colors.text}`}
            accessibilityLabel={copy.review.questionLabel(number)}
            editable={!disabled}
            multiline
            // Let the conversation/screen scroll owner display the entire field.
            scrollEnabled={false}
            onChangeText={questionText => onUpdate({ questionText })}
            style={styles.questionInput}
            testID={`next-visit-question-text-${index}`}
            value={question.questionText}
          />
        ) : (
          // Preserve a stable native identity independently of the reviewed wording and keyboard windows.
          <Text
            style={styles.questionText}
            testID={`next-visit-saved-question-text-${index}`}
          >
            {question.questionText}
          </Text>
        )}
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('visitCard.editDetails', { number })}
            accessibilityState={{ expanded: detailsOpen, disabled }}
            disabled={disabled}
            onPress={() => setDetailsOpen(open => !open)}
            style={styles.detailToggle}
            testID={`next-visit-question-details-${index}`}
          >
            <AppSymbol name="pencil" size={18} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
        {editable && !priorityInDetails ? (
          <QuestionPriorityControl
            question={question}
            index={index}
            disabled={disabled}
            theme={theme}
            onUpdate={onUpdate}
          />
        ) : null}
      </View>
      {editable && detailsOpen ? (
        <View style={styles.actions}>
          {priorityInDetails ? (
            <QuestionPriorityControl
              question={question}
              index={index}
              disabled={disabled}
              theme={theme}
              onUpdate={onUpdate}
              compact
            />
          ) : null}
          <ActionButton
            accessibilityLabel={copy.review.moveUp(number)}
            disabled={disabled || index === 0}
            onPress={() => onMove(-1)}
            theme={theme}
            testID={`next-visit-question-up-${index}`}
            title={t('visitCard.up')}
          />
          <ActionButton
            accessibilityLabel={copy.review.moveDown(number)}
            disabled={disabled || index === count - 1}
            onPress={() => onMove(1)}
            theme={theme}
            testID={`next-visit-question-down-${index}`}
            title={t('visitCard.down')}
          />
          <ActionButton
            accessibilityLabel={copy.review.remove(number)}
            disabled={disabled}
            onPress={onRemove}
            theme={theme}
            testID={`next-visit-question-remove-${index}`}
            title={t('visitCard.remove')}
          />
        </View>
      ) : null}
      {editable && detailsOpen ? (
        <View style={styles.inputGroup}>
          {/* Keep the editable rationale field understandable without relying on VoiceOver alone. */}
          <Text style={styles.inputLabel}>
            {copy.review.rationaleLabel(number)}
          </Text>
          <TextInput
            key={`rationale-${theme.colors.text}`}
            accessibilityLabel={copy.review.rationaleLabel(number)}
            editable={!disabled}
            multiline
            // Let the conversation/screen scroll owner display the entire field.
            scrollEnabled={false}
            onChangeText={rationale => onUpdate({ rationale })}
            style={styles.rationaleInput}
            testID={`next-visit-question-rationale-${index}`}
            value={question.rationale}
          />
        </View>
      ) : null}
      {/* Inline review leads with wording; provenance remains available in details. */}
      {!priorityInDetails || detailsOpen ? (
        <>
          <Text style={styles.openSource}>
            {question.kind === 'clarification'
              ? t('visitCard.clarification')
              : question.legacySource
                ? t('visitCard.legacy')
                : t('visitCard.grounded')}
          </Text>
          {question.citations.map((reference, citationIndex) => (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              key={`${reference.sourceKind}:${reference.sourceId}:${reference.effectiveTime ?? citationIndex}`}
              onPress={() => onOpenSource(reference)}
              style={[styles.sourceButton, disabled && styles.disabled]}
              testID={`next-visit-source-${index}-${citationIndex}`}
            >
              <AppSymbol name="doc.text" color={theme.colors.textMuted} />
              <Text style={styles.openSource}>
                {question.citations.length === 1
                  ? t('visitCard.singleSource')
                  : `${copy.evidence.open} ${citationIndex + 1}`}
              </Text>
              <AppSymbol
                name="chevron.right"
                size={14}
                color={theme.colors.textMuted}
              />
            </Pressable>
          ))}
          {(question.generatedArtifactContext ?? [])
            .filter(
              reference =>
                !question.citations.some(
                  citation =>
                    citation.sourceKind === reference.sourceKind &&
                    citation.sourceId === reference.sourceId,
                ),
            )
            .map((reference, sourceIndex) => (
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                key={`generated:${reference.sourceId}`}
                onPress={() => onOpenSource(reference)}
                style={[styles.sourceButton, disabled && styles.disabled]}
                testID={`next-visit-generated-source-${index}-${sourceIndex}`}
              >
                <AppSymbol name="doc.text" color={theme.colors.textMuted} />
                <Text style={styles.openSource}>
                  {t('visitCard.generatedSource')}
                </Text>
                <AppSymbol
                  name="chevron.right"
                  size={14}
                  color={theme.colors.textMuted}
                />
              </Pressable>
            ))}
        </>
      ) : null}
    </View>
  );
}
