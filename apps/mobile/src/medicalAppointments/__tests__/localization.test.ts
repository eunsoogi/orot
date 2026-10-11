import { t } from '../../i18n';
import { ko } from '../../i18n/ko';
import { medicalAppointmentsKo } from '../../i18n/medicalAppointments';
import { medicalAppointmentCopy } from '../copy.ko';

describe('medical appointment localization', () => {
  it('registers the complete feature fragment in the typed Korean catalog', () => {
    expect(ko).toMatchObject(medicalAppointmentsKo);
    expect(medicalAppointmentsKo['medicalAppointments.title']).toBe(
      '진료 일정 분류',
    );
  });

  it('interpolates returned and classified coverage counts', () => {
    expect(
      t('medicalAppointments.coverage', {
        returned: 100,
        classified: 92,
      }),
    ).toBe('불러온 일정 100건 중 92건을 분류했습니다.');
  });

  it('shortens only fully classified coverage and retains partial counts', () => {
    expect(medicalAppointmentCopy.coverage(3, 3)).toBe('일정 3건 · 분류 완료');
    expect(medicalAppointmentCopy.coverage(3, 2)).toBe(
      '불러온 일정 3건 중 2건을 분류했습니다.',
    );
    expect(medicalAppointmentCopy.coverage(3, 0)).toBe(
      '불러온 일정 3건 중 0건을 분류했습니다.',
    );
  });
});
