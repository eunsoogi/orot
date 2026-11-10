import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { styles } from './manualVisitRecordStyles';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openManualVisitRecords } from './manualVisitRecordService';
import { subscribeRecapUpdates } from '../transcription/recapUpdates';
import type {
  ManualVisitQuestion,
  ManualVisitRecords as ManualVisitRecordsService,
} from './manualVisitRecordService';

/** Confirmation is explicit: loading or selecting a prepared question never creates an asked record. */
export function ManualVisitRecords({
  appointmentId,
  open = openManualVisitRecords,
}: {
  readonly appointmentId: string;
  readonly open?: () => Promise<ManualVisitRecordsService>;
}) {
  const [items, setItems] = useState<ManualVisitQuestion[]>([]);
  const [service, setService] = useState<ManualVisitRecordsService | null>(
    null,
  );
  const [editing, setEditing] = useState<{
    questionId: string;
    recordId?: string;
    expectedRevision?: number;
  } | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const contentVersion = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const invalidate = () => {
      contentVersion.current += 1;
      setItems([]);
      setEditing(null);
      setAnswer('');
      setError('');
      setReload(value => value + 1);
    };
    const clear = subscribeLocalDataClear(invalidate);
    const source = subscribeLocalSourceDeletion(invalidate);
    // Routine progress from another recording must not discard an unfinished edit.
    const recap = subscribeRecapUpdates(() => setReload(value => value + 1));
    return () => {
      clear();
      source();
      recap();
    };
  }, []);
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
        if (active) setError('진료 질문을 불러오지 못했어요.');
      });
    return () => {
      active = false;
    };
  }, [appointmentId, open, reload]);
  useEffect(() => {
    setEditing(null);
    setAnswer('');
  }, [appointmentId]);
  const save = async () => {
    if (!service || !editing || saving.current) return;
    const item = items.find(value => value.question.id === editing.questionId);
    if (!item) return;
    saving.current = true;
    const version = contentVersion.current;
    setBusy(true);
    setError('');
    try {
      const value = answer.trim() || null;
      if (editing.recordId && editing.expectedRevision !== undefined)
        await service.edit({
          id: editing.recordId,
          expectedRevision: editing.expectedRevision,
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
      setEditing(null);
      setAnswer('');
    } catch {
      if (contentVersion.current === version)
        setError('저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  if (!items.length && !error) return null;
  return (
    <View style={styles.panel} testID="manual-visit-records">
      <Text accessibilityRole="header" style={styles.title}>
        준비한 진료 질문
      </Text>
      <Text>실제로 물어본 질문만 확인해 주세요. 답변은 비워 둘 수 있어요.</Text>
      {items.map(item => (
        <View key={item.question.id} style={styles.card}>
          <Text>{item.question.questionText}</Text>
          {item.records.map(record => (
            <View key={record.id}>
              {record.questionText !== item.question.questionText && (
                <Text>확인 당시 질문: {record.questionText}</Text>
              )}
              <Text>
                {item.staleAutomaticIds?.includes(record.id)
                  ? '원본이 변경된 기록'
                  : record.sourceMethod === 'manual_confirmed'
                    ? '직접 확인'
                    : '녹음 분석 결과'}
              </Text>
              {record.editOrigin === 'user_edit' ? (
                <Text>사용자가 수정한 답변</Text>
              ) : null}
              {record.sourceMethod === 'ai_generated' &&
                !item.staleAutomaticIds?.includes(record.id) && (
                  <Text>
                    {record.automaticSource?.result.status === 'not_found'
                      ? '이 전사에서 질문 근거를 찾지 못했어요.'
                      : record.automaticSource?.result.status ===
                          'indeterminate'
                        ? '질문 여부가 불확실해요.'
                        : '이 전사에서 질문 근거를 찾았어요.'}
                  </Text>
                )}
              {record.sourceMethod === 'ai_generated' &&
                !item.staleAutomaticIds?.includes(record.id) &&
                record.editOrigin === 'ai_analysis' &&
                record.automaticSource?.result.answers.map((result, index) => (
                  <View key={index}>
                    <Text>{result.summary}</Text>
                    <Text>
                      화자는 확인되지 않았어요. {result.speakerUncertainty}
                    </Text>
                  </View>
                ))}
              {record.sourceMethod === 'manual_confirmed' ||
              record.editOrigin === 'user_edit' ? (
                <Text>{record.answer ?? '입력한 답변 없음'}</Text>
              ) : null}
              <Button
                title="답변 수정"
                disabled={busy}
                onPress={() => {
                  setEditing({
                    questionId: item.question.id,
                    recordId: record.id,
                    expectedRevision: record.revision,
                  });
                  setAnswer(record.answer ?? '');
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
                setEditing({ questionId: item.question.id });
                setAnswer('');
                setError('');
              }}
            >
              <Text>실제로 물어봤어요</Text>
            </Pressable>
          )}
          {editing?.questionId === item.question.id && (
            <View style={styles.editor}>
              <Text>의료진 답변</Text>
              <TextInput
                accessibilityLabel="의료진 답변"
                multiline
                value={answer}
                onChangeText={setAnswer}
                editable={!busy}
                style={styles.input}
              />
              <Button title="저장" disabled={busy} onPress={save} />
              <Button
                title="취소"
                disabled={busy}
                onPress={() => {
                  setEditing(null);
                  setAnswer('');
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
            title="다시 불러오기"
            disabled={busy}
            onPress={() => setReload(value => value + 1)}
          />
        </>
      ) : null}
    </View>
  );
}
