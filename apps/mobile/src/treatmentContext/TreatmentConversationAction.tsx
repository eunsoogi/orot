import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import type { SafetyPolicyInput } from '@orot/domain';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { dispatchExplicitTreatmentAction } from '../ragConversation/conversationVisitDispatch';
import type { TreatmentEvidenceRequest } from './interfaces';
import { TreatmentSafetyForm } from './TreatmentSafetyForm';
import { treatmentConversationSender } from './treatmentConversationSender';

// This entry offers general education. It neither infers a condition from
// conversation text nor treats today's safety inputs as clinical provenance.
const generalEducation: TreatmentEvidenceRequest = {
  context: {
    version: 1,
    conditions: [],
    clinicianPlans: { status: 'unavailable' },
    publicEvidence: [],
    missingContext: [],
    conflicts: [],
  },
  sources: [],
  revalidateEvidence: async (references, signal) =>
    references.length === 0 && !signal.aborted,
};

/** Keeps the treatment interaction out of the composer and model history. */
export function TreatmentConversationAction() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const close = () => {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setResult(null);
    setOpen(false);
  };

  const submit = async (
    safetyInput: SafetyPolicyInput,
    skipEducation: boolean,
  ) => {
    if (active.current) return;
    const operation = new AbortController();
    active.current = operation;
    setPending(true);
    // Unmount the raw form immediately. Only vetted copy can survive submission.
    try {
      const outcome = await dispatchExplicitTreatmentAction(
        treatmentConversationSender({
          database: () => {
            // Keep native storage loading behind an approved local request.
            const storage =
              require('../storage/secureDatabase') as typeof import('../storage/secureDatabase');
            return storage.openLocalAgentMemoryDatabase();
          },
          action: { kind: 'request', selection: { kind: 'general_options' } },
          request: generalEducation,
          safetyInput,
          skipEducation,
        }),
        operation.signal,
      );
      if (!operation.signal.aborted)
        setResult(
          outcome.status === 'answer'
            ? outcome.answer
            : t('treatmentSafety.withheld'),
        );
    } catch {
      if (!operation.signal.aborted) setResult(t('treatmentSafety.withheld'));
    } finally {
      if (active.current === operation) {
        active.current = null;
        setPending(false);
      }
    }
  };

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
            {result !== null ? (
              <AppText accessibilityRole="alert">{result}</AppText>
            ) : pending ? (
              <AppText>{t('treatmentSafety.checking')}</AppText>
            ) : (
              <TreatmentSafetyForm onSubmit={submit} />
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
