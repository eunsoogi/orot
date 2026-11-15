import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { useNavigationPrimaryAction } from '../navigation/useNavigationPrimaryAction';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { deleteMedicalDocument } from './medicalDocumentDeletion';

/** Confirmation precedes local deletion; a synchronous claim prevents duplicate callbacks. */
export function MedicalDocumentDeleteAction({
  sourceId,
  onDeleted,
  onCommitted,
  onBusyChange,
}: {
  readonly sourceId: string;
  readonly onDeleted: () => void;
  readonly onCommitted?: () => void;
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
      // A route may redact and unmount this control before file cleanup finishes.
      // Its owner still needs the committed result; legacy local UI callbacks stay mount-bound.
      onCommitted?.();
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
  const confirm = () => {
    if (claimed.current || !mounted.current) return;
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
    );
  };
  const title = busy
    ? t('medicalDocument.delete.busy')
    : t('medicalDocument.delete.action');
  // The shared dock places page actions above the Duo rail and beside compact navigation.
  // Only presentation moves; confirmation and the synchronous deletion claim stay here.
  const hosted = useNavigationPrimaryAction({
    label: title,
    navigationLabel: t('medicalDocument.delete.delete'),
    accessibilityLabel: title,
    testID: 'medical-document-delete',
    systemImageName: 'trash',
    destructive: true,
    disabled: busy,
    onPress: confirm,
  });
  return (
    <View>
      {hosted ? null : (
        <AppButton
          title={title}
          variant="destructive"
          disabled={busy}
          testID="medical-document-delete"
          onPress={confirm}
        />
      )}
      {error ? (
        <AppText accessibilityRole="alert">
          {t('medicalDocument.delete.failed')}
        </AppText>
      ) : null}
    </View>
  );
}
