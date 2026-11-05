import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { openManualVisitRecords } from './manualVisitRecordService';
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
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setItems([]);
    setEditing(null);
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
  const save = async () => {
    if (!service || !editing || saving.current) return;
    const item = items.find(value => value.question.id === editing.questionId);
    if (!item) return;
    saving.current = true;
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
      setItems(await service.load(appointmentId));
      setEditing(null);
      setAnswer('');
    } catch {
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
              <Text>
                {record.sourceMethod === 'manual_confirmed'
                  ? '직접 확인'
                  : '녹음에서 찾은 내용'}
              </Text>
              {record.sourceMethod === 'ai_generated' &&
                record.editOrigin === 'ai_analysis' &&
                record.automaticSource?.result.answers.map((result, index) => (
                  <Text key={index}>{result.summary}</Text>
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

const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  editor: { gap: 8 },
  action: { minHeight: 44, justifyContent: 'center' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    padding: 10,
    color: appColors.text,
  },
});
