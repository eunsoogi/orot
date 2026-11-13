import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import { styles } from './manualVisitRecordStyles';
import { ManualVisitQuestionCard } from './ManualVisitQuestionCard';
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
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false);
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
    // The ref blocks repeated taps before React renders the busy button state.
    if (!service || !draft || saving.current) return;
    const item = items.find(value => matchesManualVisitDraft(value, draft));
    if (!item) return;
    saving.current = true;
    const version = contentVersion.current;
    setBusy(true);
    setSaveUnconfirmed(false);
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
      setSaveUnconfirmed(false);
    } catch {
      if (contentVersion.current === version) {
        setError(t('visitQuestions.manual.saveUnconfirmed'));
        setSaveUnconfirmed(true);
      }
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
        <ManualVisitQuestionCard
          key={item.question.id}
          item={item}
          draft={draft}
          emptyAnswerLabel={emptyAnswerLabel}
          busy={busy}
          saveUnconfirmed={saveUnconfirmed}
          onConfirm={() => {
            begin(item);
            setSaveUnconfirmed(false);
            setError('');
          }}
          onEdit={record => {
            begin(item, record);
            setSaveUnconfirmed(false);
            setError('');
          }}
          onAnswerChange={setAnswer}
          onSave={save}
          onCancel={() => {
            clearDraft();
            setSaveUnconfirmed(false);
            setError('');
          }}
        />
      ))}
      {error ? (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Button
            title={t('visitQuestions.manual.actions.reload')}
            disabled={busy}
            onPress={() => {
              setSaveUnconfirmed(false);
              setReload(value => value + 1);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
