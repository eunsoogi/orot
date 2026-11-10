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
          진료 요약을 불러오지 못했어요.
        </AppText>
      ) : null}
      {statuses.map((status, index) => (
        <AppText key={index} accessibilityLiveRegion="polite">
          {status === 'analyzing' || status === 'saving' || status === 'pending'
            ? '진료 요약 처리를 기다리거나 진행 중이에요.'
            : status === 'consent_required'
              ? '진료 요약을 위한 전송 동의가 필요해요.'
              : status === 'no_questions'
                ? '준비된 질문이 없어 요약하지 않았어요.'
                : '진료 요약을 완료하지 못했어요.'}
        </AppText>
      ))}
      {statuses.some(
        status =>
          !['pending', 'analyzing', 'saving', 'no_questions'].includes(status),
      ) ? (
        <AppButton
          title="진료 요약 다시 시도"
          variant="secondary"
          onPress={() => requestRecapRetry(appointmentId)}
        />
      ) : null}
      {results.map(result => (
        <View key={result.recordingSourceId}>
          <AppText accessibilityRole="header">자동 저장된 진료 요약</AppText>
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
                    내가 수정한 답변: {record.answer ?? '답변 없음'}
                  </AppText>
                ))}
              <AppText>
                {question.status === 'evidence_found'
                  ? '녹음에서 질문을 찾았어요'
                  : question.status === 'not_found'
                    ? '이 전사에서 찾지 못했어요'
                    : '확인하기 어려워요'}
              </AppText>
              {question.answers.map((answer, index) => (
                <View key={index}>
                  <AppText>원문: {answer.quotation}</AppText>
                  <AppText>AI 요약: {answer.summary}</AppText>
                  <AppText>화자 미확인: {answer.speakerUncertainty}</AppText>
                  {answer.evidence.map((evidence, evidenceIndex) => (
                    <AppButton
                      key={evidenceIndex}
                      variant="text"
                      title="원본 녹음 듣기"
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
