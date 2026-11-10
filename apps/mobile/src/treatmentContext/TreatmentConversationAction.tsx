import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import type { SafetyPolicyInput } from '@orot/domain';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { dispatchExplicitTreatmentAction } from '../ragConversation/conversationVisitDispatch';
import { generalEducation, savedEducation } from './localTreatmentEvidence';
import { TreatmentActionResult } from './TreatmentActionResult';
import { TreatmentSafetyForm } from './TreatmentSafetyForm';
import { treatmentConversationSender } from './treatmentConversationSender';
import {
  openTreatmentDatabase,
  TreatmentLibraryChoices,
  treatmentSourceLabel,
} from './TreatmentLibraryChoices';
import {
  deleteSavedTreatment,
  prepareTreatmentRetention,
} from './treatmentSavedLibrary';
import type { SavedTreatmentChoice } from './treatmentSavedLibrary';
import type { TreatmentSourceChoice } from './treatmentSourceChoices';
import type { TreatmentRequestAction } from './treatmentRequestProducer';

/** Keeps the treatment interaction out of the composer and model history. */
export function TreatmentConversationAction() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    answer: string;
    verified: boolean;
    sourceCount?: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<'form' | 'sources' | 'saved'>('form');
  const [source, setSource] = useState<TreatmentSourceChoice | null>(null);
  const [saved, setSaved] = useState<SavedTreatmentChoice | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const close = () => {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setResult(null);
    setSource(null);
    setSaved(null);
    setFollowUp(false);
    setMode('form');
    setOpen(false);
  };

  const run = async (perform: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const operation = new AbortController();
    active.current = operation;
    // Unmount the form before processing. No raw input reaches screen state.
    setPending(true);
    setResult(null);
    try {
      await perform(operation.signal);
    } catch {
      if (!operation.signal.aborted)
        setResult({ answer: t('treatmentSafety.withheld'), verified: false });
    } finally {
      if (active.current === operation) {
        active.current = null;
        setPending(false);
      }
    }
  };

  const submit = (
    safetyInput: SafetyPolicyInput,
    skipEducation: boolean,
    save = false,
  ) =>
    run(async signal => {
      const action: TreatmentRequestAction = saved
        ? followUp
          ? {
              kind: 'follow_up',
              artifactId: saved.id,
              sessionId: saved.sessionId,
              selection: { kind: 'source_question', index: 0 },
            }
          : { kind: 'reopen', artifactId: saved.id, sessionId: saved.sessionId }
        : {
            kind: 'request',
            selection: source
              ? { kind: 'condition', index: 0 }
              : { kind: 'general_options' },
          };
      const outcome = await dispatchExplicitTreatmentAction(
        treatmentConversationSender({
          database: openTreatmentDatabase,
          action,
          request:
            source?.request ?? (saved ? savedEducation : generalEducation),
          safetyInput,
          skipEducation,
          ...(save
            ? {
                prepareRetention: (database, retentionSignal) =>
                  prepareTreatmentRetention(
                    database,
                    retentionSignal,
                    saved ?? undefined,
                  ),
                onSaved: item => {
                  if (!signal.aborted) setSaved(item);
                },
              }
            : {}),
        }),
        signal,
      );
      if (!signal.aborted)
        setResult({
          answer:
            outcome.status === 'answer'
              ? outcome.answer
              : t('treatmentSafety.withheld'),
          verified:
            outcome.status === 'answer' && outcome.completion === 'partial',
          sourceCount:
            outcome.status === 'answer' ? outcome.citations.length : 0,
        });
    });

  const remove = (item: SavedTreatmentChoice) =>
    run(async signal => {
      const database = await openTreatmentDatabase();
      if (signal.aborted) return;
      await deleteSavedTreatment(database, item);
      if (signal.aborted) return;
      setSaved(null);
      setFollowUp(false);
      setMode('saved');
    });

  return (
    <>
      <AppButton
        variant="secondary"
        title={t('treatmentSafety.open')}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Modal
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={close}
        >
          <ScrollView
            accessibilityViewIsModal
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.content}
            style={styles.screen}
            keyboardShouldPersistTaps="handled"
          >
            <AppButton
              variant="text"
              title={t('treatmentSafety.close')}
              onPress={close}
            />
            <AppText accessibilityRole="header">
              {t('treatmentSafety.confirmation')}
            </AppText>
            {pending ? (
              <AppText>{t('treatmentSafety.checking')}</AppText>
            ) : result !== null ? (
              <TreatmentActionResult
                answer={result.answer}
                showLimits={result.verified && Boolean(source || saved)}
                sourceCount={result.sourceCount}
                onFollowUp={
                  result.verified && saved
                    ? () => {
                        setSource(null);
                        setFollowUp(true);
                        setResult(null);
                      }
                    : undefined
                }
                onDelete={saved ? () => remove(saved) : undefined}
              />
            ) : mode !== 'form' ? (
              <TreatmentLibraryChoices
                key={mode}
                mode={mode}
                onSource={choice => {
                  setSource(choice);
                  setMode('form');
                }}
                onSaved={choice => {
                  setSaved(choice);
                  setMode('form');
                }}
              />
            ) : (
              <>
                {source ? (
                  <AppText>
                    {treatmentSourceLabel(source)} · {source.label}
                  </AppText>
                ) : null}
                {saved ? (
                  <AppButton
                    variant="destructive"
                    title={t('treatmentSafety.deleteSaved')}
                    onPress={() => remove(saved)}
                  />
                ) : null}
                {!source && !saved ? (
                  <>
                    <AppButton
                      variant="secondary"
                      title={t('treatmentSafety.chooseSource')}
                      onPress={() => setMode('sources')}
                    />
                    <AppButton
                      variant="secondary"
                      title={t('treatmentSafety.saved')}
                      onPress={() => setMode('saved')}
                    />
                  </>
                ) : null}
                <TreatmentSafetyForm
                  onSubmit={submit}
                  allowSave={Boolean(source || followUp)}
                />
              </>
            )}
          </ScrollView>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.surface },
  content: { padding: 20, gap: 12 },
});
