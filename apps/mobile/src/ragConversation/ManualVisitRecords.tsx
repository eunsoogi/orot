import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import { styles } from './manualVisitRecordStyles';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openManualVisitRecords } from './manualVisitRecordService';
import {
  matchesManualVisitDraft,
  useManualVisitDraft,
  type ManualVisitDrafts,
} from './useManualVisitDraft';
import { subscribeRecapUpdates } from '../transcription/recapUpdates';
import type {
  ManualVisitQuestion,
  ManualVisitRecords as ManualVisitRecordsService,
} from './manualVisitRecordService';

/** Confirmation is explicit: loading or selecting a prepared question never creates an asked record. */
export function ManualVisitRecords({
  appointmentId,
  open = openManualVisitRecords,
  drafts,
}: {
  readonly appointmentId: string;
  readonly open?: () => Promise<ManualVisitRecordsService>;
  readonly drafts?: ManualVisitDrafts;
}) {
  const [items, setItems] = useState<ManualVisitQuestion[]>([]);
  const [service, setService] = useState<ManualVisitRecordsService | null>(
    null,
  );
  const {
    draft,
    clear: clearDraft,
    begin,
    setAnswer,
  } = useManualVisitDraft(appointmentId, drafts);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const contentVersion = useRef(0);
  const [reload, setReload] = useState(0);
  const emptyAnswerLabel = t('visitQuestions.manual.answer.empty');
  useEffect(() => {
    const invalidate = () => {
      contentVersion.current += 1;
      setItems([]);
      clearDraft();
      setError('');
      setReload(value => value + 1);
    };
    const clear = subscribeLocalDataClear(invalidate);
    const source = subscribeLocalSourceDeletion(invalidate, 'local');
    // Unrelated HealthKit deletions and recap progress must not discard an unfinished edit.
    const recap = subscribeRecapUpdates(() => setReload(value => value + 1));
    return () => {
      contentVersion.current += 1;
      clear();
      source();
      recap();
    };
  }, [clearDraft]);
  useEffect(() => {
    let active = true;
    setItems([]);
    setService(null);
    setError('');
    open()
      .then(async value => {
        const loaded = await value.load(appointmentId);
        if (active) {
          setService(value);
          setItems(loaded);
        }
      })
      .catch(() => {
        if (active) setError(t('visitQuestions.manual.loadError'));
      });
    return () => {
      active = false;
    };
  }, [appointmentId, open, reload]);
  const save = async () => {
    if (!service || !draft || saving.current) return;
    const item = items.find(value => matchesManualVisitDraft(value, draft));
    if (!item) return;
    saving.current = true;
    const version = contentVersion.current;
    setBusy(true);
    setError('');
    try {
      const value = draft.answer.trim() || null;
      if (draft.recordId && draft.recordRevision !== undefined)
        await service.edit({
          id: draft.recordId,
          expectedRevision: draft.recordRevision,
          answer: value,
        });
      else
        await service.saveManual({
          appointmentId,
          questionId: item.question.id,
          expectedQuestionRevision: item.revision,
          answer: value,
        });
      const loaded = await service.load(appointmentId);
      if (contentVersion.current !== version) return;
      setItems(loaded);
      clearDraft();
    } catch {
      if (contentVersion.current === version)
        setError(t('visitQuestions.manual.saveUnconfirmed'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  if (!items.length && !error) return null;
  return (
    <View style={styles.panel} testID="manual-visit-records">
      <Text accessibilityRole="header" style={styles.title}>
        {t('visitQuestions.manual.title')}
      </Text>
      <Text>{t('visitQuestions.manual.instructions')}</Text>
      {items.map(item => (
        <View key={item.question.id} style={styles.card}>
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
              <Text>
                {item.staleAutomaticIds?.includes(record.id)
                  ? t('visitQuestions.manual.source.stale')
                  : record.sourceMethod === 'manual_confirmed'
                    ? t('visitQuestions.manual.source.confirmed')
                    : t('visitQuestions.manual.source.recordingAnalysis')}
              </Text>
              {record.editOrigin === 'user_edit' ? (
                <Text>{t('visitQuestions.manual.answer.userEdited')}</Text>
              ) : null}
              {record.sourceMethod === 'ai_generated' &&
                !item.staleAutomaticIds?.includes(record.id) && (
                  <Text>
                    {record.automaticSource?.result.status === 'not_found'
                      ? t('visitQuestions.manual.evidence.notFound')
                      : record.automaticSource?.result.status ===
                          'indeterminate'
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
              {record.sourceMethod === 'manual_confirmed' ||
              record.editOrigin === 'user_edit' ? (
                <Text>{record.answer ?? emptyAnswerLabel}</Text>
              ) : null}
              <Button
                title={t('visitQuestions.manual.actions.edit')}
                disabled={busy}
                onPress={() => {
                  begin(item, record);
                  setError('');
                }}
              />
            </View>
          ))}
          {!item.records.some(
            record => record.sourceMethod === 'manual_confirmed',
          ) && (
            <Pressable
              accessibilityRole="button"
              style={styles.action}
              disabled={busy}
              onPress={() => {
                begin(item);
                setError('');
              }}
            >
              <Text>{t('visitQuestions.manual.actions.confirmAsked')}</Text>
            </Pressable>
          )}
          {draft && matchesManualVisitDraft(item, draft) && (
            <View style={styles.editor}>
              <Text>{t('visitQuestions.manual.answer.label')}</Text>
              <TextInput
                accessibilityLabel={t('visitQuestions.manual.answer.label')}
                multiline
                value={draft.answer}
                onChangeText={setAnswer}
                editable={!busy}
                style={styles.input}
              />
              <Button
                title={t('visitQuestions.manual.actions.save')}
                disabled={busy}
                onPress={save}
              />
              <Button
                title={t('visitQuestions.manual.actions.cancel')}
                disabled={busy}
                onPress={() => {
                  clearDraft();
                  setError('');
                }}
              />
            </View>
          )}
        </View>
      ))}
      {error ? (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Button
            title={t('visitQuestions.manual.actions.reload')}
            disabled={busy}
            onPress={() => setReload(value => value + 1)}
          />
        </>
      ) : null}
    </View>
  );
}
