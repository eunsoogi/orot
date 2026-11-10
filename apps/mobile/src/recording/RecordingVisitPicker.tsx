import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Appointment } from '@orot/domain';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { RecordingStatus } from './recordingTypes';

export function OptionalRecordingVisitPicker({
  selected,
  onSelect,
  busy,
  status,
}: {
  selected: string | null;
  onSelect?: (id: string | null) => void;
  busy: boolean;
  status: RecordingStatus;
}) {
  if (!onSelect) return null;
  return (
    <RecordingVisitPicker
      selected={selected}
      onSelect={onSelect}
      disabled={
        busy ||
        status === 'recording' ||
        status === 'paused' ||
        status === 'interrupted'
      }
    />
  );
}

/** A visit is selected explicitly; a date or transcript never chooses one automatically. */
export function RecordingVisitPicker({
  selected,
  onSelect,
  disabled,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  disabled: boolean;
}) {
  const [visits, setVisits] = useState<Appointment[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    import('../storage/secureDatabase')
      .then(module => module.openLocalAppointmentRepository())
      .then(repository => repository.list())
      .then(
        value => {
          if (current)
            setVisits(value.filter(visit => visit.status !== 'cancelled'));
        },
        () => {
          if (current) setFailed(true);
        },
      );
    return () => {
      current = false;
    };
  }, []);
  return (
    <View>
      <AppText>{t('recording.visitPicker.heading')}</AppText>
      {failed ? (
        <AppText accessibilityRole="alert">
          {t('recording.visitPicker.loadError')}
        </AppText>
      ) : null}
      <AppButton
        variant="neutral"
        title={t('recording.visitPicker.disconnect')}
        disabled={disabled}
        accessibilityState={{ selected: selected === null }}
        onPress={() => onSelect(null)}
      />
      {visits.map(visit => (
        <AppButton
          key={visit.id}
          variant="list"
          disabled={disabled}
          title={t('recording.visitPicker.visitTitle', {
            clinic:
              visit.clinicLabel || t('recording.visitPicker.visitFallback'),
            date: new Date(visit.effectiveAt).toLocaleString('ko-KR'),
          })}
          accessibilityState={{ selected: selected === visit.id }}
          onPress={() => onSelect(visit.id)}
        />
      ))}
    </View>
  );
}
