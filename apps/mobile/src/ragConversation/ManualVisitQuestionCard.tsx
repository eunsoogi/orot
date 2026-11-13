import { TextInput, View } from 'react-native';
import type { VisitQuestionRecord } from '@orot/domain';
import { AppButton as Button } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './manualVisitRecordStyles';
import {
  matchesManualVisitDraft,
  type ManualVisitDraft,
} from './useManualVisitDraft';
import type { ManualVisitQuestion } from './manualVisitRecordService';

interface ManualVisitQuestionCardProps {
  readonly item: ManualVisitQuestion;
  readonly draft: ManualVisitDraft | null;
  readonly emptyAnswerLabel: string;
  readonly busy: boolean;
  readonly saveUnconfirmed: boolean;
  readonly onConfirm: () => void;
  readonly onEdit: (record: VisitQuestionRecord) => void;
  readonly onAnswerChange: (answer: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** Presents asked-question state while leaving persistence and correction to the caller. */
export function ManualVisitQuestionCard({
  item,
  draft,
  emptyAnswerLabel,
  busy,
  saveUnconfirmed,
  onConfirm,
  onEdit,
  onAnswerChange,
  onSave,
  onCancel,
}: ManualVisitQuestionCardProps) {
  const activeDraft =
    draft && matchesManualVisitDraft(item, draft) ? draft : null;
  // A saved manual record is completion; corrections stay on the versioned edit path.
  const hasManualConfirmation = item.records.some(
    record => record.sourceMethod === 'manual_confirmed',
  );
  const hasPendingConfirmation = Boolean(activeDraft && !activeDraft.recordId);

  return (
    <View style={styles.card}>
      <Text>{item.question.questionText}</Text>
      {item.records.map(record => (
        <View key={record.id}>
          {record.questionText !== item.question.questionText && (
            <Text>
              {t('visitQuestions.manual.questionAtConfirmation', {
                question: record.questionText,
              })}
            </Text>
          )}
          {record.sourceMethod === 'manual_confirmed' ? (
            <View
              accessible
              accessibilityRole="checkbox"
              accessibilityLabel={t('visitQuestions.manual.status.confirmed')}
              accessibilityState={{ checked: true, disabled: true }}
              style={styles.confirmedStatus}
            >
              <AppSymbol name="checkmark.circle.fill" size={18} />
              <Text style={styles.confirmedStatusText}>
                {t('visitQuestions.manual.status.confirmed')}
              </Text>
            </View>
          ) : (
            <Text>
              {item.staleAutomaticIds?.includes(record.id)
                ? t('visitQuestions.manual.source.stale')
                : t('visitQuestions.manual.source.recordingAnalysis')}
            </Text>
          )}
          {record.editOrigin === 'user_edit' ? (
            <Text>{t('visitQuestions.manual.answer.userEdited')}</Text>
          ) : null}
          {record.sourceMethod === 'ai_generated' &&
            !item.staleAutomaticIds?.includes(record.id) && (
              <Text>
                {record.automaticSource?.result.status === 'not_found'
                  ? t('visitQuestions.manual.evidence.notFound')
                  : record.automaticSource?.result.status === 'indeterminate'
                    ? t('visitQuestions.manual.evidence.indeterminate')
                    : t('visitQuestions.manual.evidence.found')}
              </Text>
            )}
          {record.sourceMethod === 'ai_generated' &&
            !item.staleAutomaticIds?.includes(record.id) &&
            record.editOrigin === 'ai_analysis' &&
            record.automaticSource?.result.answers.map((result, index) => (
              <View key={index}>
                <Text>{result.summary}</Text>
                <Text>
                  {t('visitQuestions.manual.answer.speakerUncertainty', {
                    uncertainty: result.speakerUncertainty,
                  })}
                </Text>
              </View>
            ))}
          {(record.sourceMethod === 'manual_confirmed' ||
            record.editOrigin === 'user_edit') && (
            <Text>{record.answer ?? emptyAnswerLabel}</Text>
          )}
          <Button
            title={t('visitQuestions.manual.actions.edit')}
            disabled={busy}
            onPress={() => onEdit(record)}
          />
        </View>
      ))}
      {!hasManualConfirmation && !hasPendingConfirmation && (
        <Button
          title={t('visitQuestions.manual.actions.confirmAsked')}
          variant="secondary"
          size="compact"
          style={styles.confirmationButton}
          accessibilityHint={t(
            'visitQuestions.manual.actions.confirmAskedHint',
          )}
          disabled={busy}
          onPress={onConfirm}
        />
      )}
      {activeDraft && (
        <View style={styles.editor}>
          {hasPendingConfirmation && (
            <Text style={styles.confirmationStatus}>
              {busy
                ? t('visitQuestions.manual.status.saving')
                : saveUnconfirmed
                  ? t('visitQuestions.manual.status.saveUnconfirmed')
                  : t('visitQuestions.manual.status.pending')}
            </Text>
          )}
          <Text>{t('visitQuestions.manual.answer.label')}</Text>
          <TextInput
            accessibilityLabel={t('visitQuestions.manual.answer.label')}
            multiline
            value={activeDraft.answer}
            onChangeText={onAnswerChange}
            editable={!busy}
            style={styles.input}
          />
          <Button
            title={
              busy
                ? t('visitQuestions.manual.actions.saving')
                : saveUnconfirmed
                  ? t('visitQuestions.manual.actions.retrySave')
                  : t('visitQuestions.manual.actions.save')
            }
            busy={busy}
            disabled={busy}
            onPress={() => {
              onSave();
            }}
          />
          <Button
            title={t('visitQuestions.manual.actions.cancel')}
            disabled={busy}
            onPress={onCancel}
          />
        </View>
      )}
    </View>
  );
}
