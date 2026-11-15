import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { deleteMedicalDocument } from './medicalDocumentDeletion';

/** Confirmation precedes local deletion; a synchronous claim prevents duplicate callbacks. */
export function MedicalDocumentDeleteAction({
  sourceId,
  onDeleted,
  onBusyChange,
}: {
  readonly sourceId: string;
  readonly onDeleted: () => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const claimed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const remove = async () => {
    if (claimed.current || !mounted.current) return;
    claimed.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(false);
    try {
      const result = await deleteMedicalDocument(sourceId);
      if (mounted.current) onDeleted();
      if (result.cleanupPending)
        Alert.alert(
          t('medicalDocument.delete.done'),
          t('medicalDocument.delete.cleanup'),
        );
    } catch {
      if (mounted.current) setError(true);
      else Alert.alert(t('medicalDocument.delete.failed'));
    } finally {
      claimed.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        testID="medical-document-delete"
        style={styles.button}
        onPress={() =>
          Alert.alert(
            t('medicalDocument.delete.confirm'),
            t('medicalDocument.delete.description'),
            [
              { text: t('medicalDocument.delete.cancel'), style: 'cancel' },
              {
                text: t('medicalDocument.delete.delete'),
                style: 'destructive',
                onPress: () => {
                  remove().catch(() => undefined);
                },
              },
            ],
          )
        }
      >
        <AppText>
          {busy
            ? t('medicalDocument.delete.busy')
            : t('medicalDocument.delete.action')}
        </AppText>
      </Pressable>
      {error ? (
        <AppText accessibilityRole="alert">
          {t('medicalDocument.delete.failed')}
        </AppText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center' },
});
