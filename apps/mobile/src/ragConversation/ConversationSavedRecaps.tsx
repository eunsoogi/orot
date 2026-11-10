import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { RecapResult, VisitQuestionRecord } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import {
  createVisitQuestionRecordRepository,
  readCurrentRecapResult,
} from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { recordingService } from '../recording/recordingService';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  requestRecapRetry,
  subscribeRecapUpdates,
} from '../transcription/recapUpdates';

/** A conversation may reopen only results for its explicitly selected visit. */
async function openDatabase(): Promise<SqlDatabase> {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return openLocalAgentMemoryDatabase();
}

export function ConversationSavedRecaps({
  appointmentId,
  loadDatabase = openDatabase,
}: {
  appointmentId: string;
  loadDatabase?: () => Promise<SqlDatabase>;
}) {
  const [results, setResults] = useState<RecapResult[]>([]);
  const [failed, setFailed] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [records, setRecords] = useState<VisitQuestionRecord[]>([]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      (async () => {
        const database = await loadDatabase();
        const official =
          await createVisitQuestionRecordRepository(
            database,
          ).listForAppointment(appointmentId);
        const pending = await database.execute(
          "SELECT work_status FROM recap_bindings WHERE appointment_id = ? AND work_status <> 'saved' ORDER BY recording_id",
          [appointmentId],
        );
        const rows = await database.execute(
          `SELECT r.recording_id FROM recap_results r
        JOIN recap_bindings b ON b.recording_id = r.recording_id
        WHERE b.appointment_id = ? AND r.saved = 1 ORDER BY r.recording_id`,
          [appointmentId],
        );
        const loaded: RecapResult[] = [];
        for (const row of rows.rows) {
          if (typeof row.recording_id !== 'string') continue;
          const result = await readCurrentRecapResult(
            database,
            row.recording_id,
          );
          if (result && result.appointmentId === appointmentId)
            loaded.push(result);
        }
        if (active && current === revision) {
          setResults(loaded);
          setRecords(official);
          setStatuses(pending.rows.map(row => String(row.work_status)));
          setFailed(false);
        }
      })().catch(() => {
        if (active && current === revision) {
          setResults([]);
          setRecords([]);
          setStatuses([]);
          setFailed(true);
        }
      });
    };
    refresh();
    const invalidate = () => {
      setResults([]);
      setRecords([]);
      setStatuses([]);
      refresh();
    };
    const unsubscribe = subscribeRecapUpdates(invalidate);
    const unsubscribeClear = subscribeLocalDataClear(invalidate);
    const unsubscribeDeletion = subscribeLocalSourceDeletion(invalidate);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeClear();
      unsubscribeDeletion();
    };
  }, [appointmentId, loadDatabase]);
  return (
    <View>
      {failed ? (
        <AppText accessibilityRole="alert">
          {t('visitQuestions.recap.loadError')}
        </AppText>
      ) : null}
      {statuses.map((status, index) => (
        <AppText key={index} accessibilityLiveRegion="polite">
          {status === 'analyzing' || status === 'saving' || status === 'pending'
            ? t('visitQuestions.recap.status.pending')
            : status === 'consent_required'
              ? t('visitQuestions.recap.status.consentRequired')
              : status === 'no_questions'
                ? t('visitQuestions.recap.status.noQuestions')
                : t('visitQuestions.recap.status.failed')}
        </AppText>
      ))}
      {statuses.some(
        status =>
          !['pending', 'analyzing', 'saving', 'no_questions'].includes(status),
      ) ? (
        <AppButton
          title={t('visitQuestions.recap.actions.retry')}
          variant="secondary"
          onPress={() => requestRecapRetry(appointmentId)}
        />
      ) : null}
      {results.map(result => (
        <View key={result.recordingSourceId}>
          <AppText accessibilityRole="header">
            {t('visitQuestions.recap.heading')}
          </AppText>
          {result.questions.map(question => (
            <View key={question.questionId}>
              <AppText>
                {
                  result.preparedQuestions.find(
                    item => item.id === question.questionId,
                  )?.questionText
                }
              </AppText>
              {records
                .filter(
                  record =>
                    record.questionId === question.questionId &&
                    record.automaticSource?.recordingSourceId ===
                      result.recordingSourceId &&
                    record.editOrigin === 'user_edit',
                )
                .map(record => (
                  <AppText key={record.id}>
                    {t('visitQuestions.recap.answer.userEdited', {
                      answer:
                        record.answer ?? t('visitQuestions.recap.answer.empty'),
                    })}
                  </AppText>
                ))}
              <AppText>
                {question.status === 'evidence_found'
                  ? t('visitQuestions.recap.questionStatus.evidenceFound')
                  : question.status === 'not_found'
                    ? t('visitQuestions.recap.questionStatus.notFound')
                    : t('visitQuestions.recap.questionStatus.uncertain')}
              </AppText>
              {question.answers.map((answer, index) => (
                <View key={index}>
                  <AppText>
                    {t('visitQuestions.recap.answer.quotation', {
                      quotation: answer.quotation,
                    })}
                  </AppText>
                  <AppText>
                    {t('visitQuestions.recap.answer.summary', {
                      summary: answer.summary,
                    })}
                  </AppText>
                  <AppText>
                    {t('visitQuestions.recap.answer.speakerUncertainty', {
                      uncertainty: answer.speakerUncertainty,
                    })}
                  </AppText>
                  {answer.evidence.map((evidence, evidenceIndex) => (
                    <AppButton
                      key={evidenceIndex}
                      variant="text"
                      title={t(
                        'visitQuestions.recap.actions.playOriginalRecording',
                      )}
                      onPress={() => {
                        recordingService
                          .playRange(
                            result.recordingSourceId,
                            evidence.audioRange.startMs,
                            evidence.audioRange.endMs,
                          )
                          .catch(() => setFailed(true));
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
