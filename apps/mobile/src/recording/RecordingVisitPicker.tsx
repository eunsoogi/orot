import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Appointment } from '@orot/domain';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';

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
      <AppText>연결할 진료 선택 (선택 사항)</AppText>
      {failed ? (
        <AppText accessibilityRole="alert">
          진료 목록을 불러오지 못했어요.
        </AppText>
      ) : null}
      <AppButton
        variant="neutral"
        title="연결하지 않기"
        disabled={disabled}
        accessibilityState={{ selected: selected === null }}
        onPress={() => onSelect(null)}
      />
      {visits.map(visit => (
        <AppButton
          key={visit.id}
          variant="list"
          disabled={disabled}
          title={`${visit.clinicLabel || '진료'} · ${new Date(visit.effectiveAt).toLocaleString('ko-KR')}`}
          accessibilityState={{ selected: selected === visit.id }}
          onPress={() => onSelect(visit.id)}
        />
      ))}
    </View>
  );
}
