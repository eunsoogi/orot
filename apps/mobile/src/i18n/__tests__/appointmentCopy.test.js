import { readFileSync } from 'node:fs';
import path from 'node:path';
import { t } from '..';

// Localized copy must preserve the lock-screen privacy promise and distinguish
// an unavailable AI action from an actual completed generation.
test('appointment copy retains privacy, permission and generation boundaries', () => {
  expect(t('appointments.preparation.lockScreenPrivacy')).toBe(
    '잠금 화면에는 예약 내용 없이 준비 안내만 표시해요.',
  );
  expect(t('appointments.preparation.unsupportedGeneration')).toContain(
    '이 예약의 AI 질문 생성은 지원하지 않아요.',
  );
  expect(t('appointments.preparation.unscheduled')).toContain(
    '시간과 알림 권한을 확인',
  );
});

test.each(['AppointmentPreparationRoute', 'AppointmentReminderControls'])(
  '%s uses catalog copy rather than inline Korean',
  name => {
    const file = path.join(
      __dirname,
      '../../appointmentReminders',
      `${name}.tsx`,
    );
    expect(/[가-힣]/u.test(readFileSync(file, 'utf8'))).toBe(false);
  },
);
