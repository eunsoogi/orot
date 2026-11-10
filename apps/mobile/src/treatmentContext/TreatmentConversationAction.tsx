import { Modal, ScrollView, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { TreatmentActionResult } from './TreatmentActionResult';
import { TreatmentSafetyForm } from './TreatmentSafetyForm';
import {
  TreatmentLibraryChoices,
  treatmentSourceLabel,
} from './TreatmentLibraryChoices';
import {
  useTreatmentConversationAction,
  type TreatmentActionProps,
} from './useTreatmentConversationAction';

/** Keep local treatment inputs and results outside the ordinary transcript. */
export function TreatmentConversationAction(props: TreatmentActionProps) {
  const {
    open,
    setOpen,
    result,
    pending,
    submitFailed,
    mode,
    setMode,
    source,
    setSource,
    saved,
    setSaved,
    followUp,
    setFollowUp,
    publicTopic,
    setPublicTopic,
    setResult,
    close,
    submit,
    remove,
    openSource,
  } = useTreatmentConversationAction(props);
  const lease = props.ownership.lease(props.sessionId);
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
            ) : null}
            {pending === 'other' ? null : result !== null ? (
              <TreatmentActionResult
                answer={result.answer}
                showLimits={result.verified && !publicTopic}
                general={result.general}
                sources={result.links}
                onOpenSource={
                  props.ownership.resolveSource ? openSource : undefined
                }
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
                key={`${mode}:${lease?.id ?? ''}:${lease?.version ?? ''}`}
                mode={mode}
                lease={lease}
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
                {submitFailed ? (
                  <AppText accessibilityRole="alert">
                    {t('treatmentSafety.withheld')}
                  </AppText>
                ) : null}
                {source ? (
                  <AppText>
                    {treatmentSourceLabel(source)} · {source.label}
                  </AppText>
                ) : null}
                {saved ? (
                  <AppButton
                    variant="destructive"
                    title={t('treatmentSafety.deleteSaved')}
                    disabled={pending === 'submit'}
                    onPress={() => remove(saved)}
                  />
                ) : null}
                {publicTopic ? (
                  <AppText>{t('treatmentSafety.hypertensionTopic')}</AppText>
                ) : null}
                {!source && !saved && !publicTopic ? (
                  <>
                    <AppButton
                      variant="secondary"
                      title={t('treatmentSafety.chooseHypertension')}
                      disabled={pending === 'submit'}
                      onPress={() => setPublicTopic('hypertension')}
                    />
                    <AppButton
                      variant="secondary"
                      title={t('treatmentSafety.chooseSource')}
                      disabled={pending === 'submit'}
                      onPress={() => setMode('sources')}
                    />
                    <AppButton
                      variant="secondary"
                      title={t('treatmentSafety.saved')}
                      disabled={pending === 'submit'}
                      onPress={() => setMode('saved')}
                    />
                  </>
                ) : null}
                <TreatmentSafetyForm
                  onSubmit={submit}
                  disabled={pending === 'submit'}
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
