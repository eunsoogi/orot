import { commonObservationsKo } from './healthkitCommonObservations';
import { bloodPressureKo } from './healthkitBloodPressure';
import { aiFeatureCatalogsKo } from './aiFeatureCatalogs';
import { medicalAppointmentsKo } from './medicalAppointments';
import { backupKo } from './backupKo';
import { recordingKo } from './recordingKo';
import { providerAccountsKo } from './providerAccounts';

export const ko = {
  ...backupKo,
  'app.welcome.title': 'Orot에 오신 걸 환영해요',
  'app.welcome.message': 'Orot의 첫걸음이에요.',
  'app.welcome.started': '이제 시작할 수 있어요.',
  'app.actions.getStarted': '시작하기',
  'app.actions.appointments': '예약',
  'app.actions.recording': '상담 녹음',
  ...recordingKo,
  'appointments.title': '예약',
  'appointments.back': '뒤로',
  'appointments.opening': '예약 정보를 준비하고 있어요…',
  'appointments.openError': '예약을 열지 못했어요. 다시 시도해 주세요.',
  'appointments.retry': '다시 시도',
  'appointments.description': '진료 예약 정보를 이 기기에 저장해요.',
  'appointments.loadError': '예약을 불러오지 못했어요. 다시 시도해 주세요.',
  'appointments.loading': '예약을 불러오는 중…',
  'appointments.empty': '등록된 예약이 없어요.',
  'appointments.fallbackTitle': '예약',
  'appointments.localTime': '현지 시간',
  'appointments.status.scheduled': '예정',
  'appointments.status.rescheduled': '일정 변경',
  'appointments.status.completed': '완료',
  'appointments.status.cancelled': '취소됨',
  'appointments.validation.clinicRequired': '병원 또는 진료과를 입력해 주세요.',
  'appointments.validation.dateTimeInvalid':
    '올바른 날짜와 시간을 입력해 주세요.',
  'appointments.errors.invalidTime': '예약 시간 정보가 올바르지 않아요.',
  'appointments.saveError': '예약을 저장하지 못했어요. 다시 시도해 주세요.',
  'appointments.cancelError': '예약을 취소하지 못했어요. 다시 시도해 주세요.',
  'appointments.saved': '예약을 저장했어요.',
  'appointments.updated': '예약을 수정했어요.',
  'appointments.cancelled': '예약을 취소했어요.',
  'appointments.form.editTitle': '예약 수정',
  'appointments.form.newTitle': '새 예약',
  'appointments.form.clinicLabel': '병원 또는 진료과',
  'appointments.form.dateLabel': '예약 날짜',
  'appointments.form.timeLabel': '예약 시간',
  'appointments.form.timezoneHint':
    '날짜와 시간은 기기의 현지 시간대로 표시돼요.',
  'appointments.form.noteLabel': '메모 (선택)',
  'appointments.actions.add': '예약 추가',
  'appointments.actions.edit': '수정',
  'appointments.actions.cancel': '예약 취소',
  'appointments.actions.cancelForClinic': '{clinic} 예약 취소',
  'appointments.actions.save': '저장',
  'appointments.actions.saving': '저장 중…',
  'appointments.actions.close': '닫기',
  'calendar.title': '캘린더 연결',
  'calendar.description':
    '예정된 일정은 이 기기에서만 확인해요. 외래 일정은 직접 선택하고 확인해 주세요.',
  'calendar.permissionExplanation':
    'iOS는 일정을 읽을 때 캘린더 전체 접근(읽기 및 쓰기)을 요구해요. Orot는 선택한 일정 정보만 이 기기에 저장하고, 캘린더를 수정하거나 삭제하지 않아요.',
  'calendar.connect': '캘린더 일정 불러오기',
  'calendar.chooseAnother': '다른 일정 선택',
  'calendar.back': '뒤로',
  'calendar.loading': '캘린더 일정을 확인하고 있어요…',
  'calendar.empty': '조회된 일정이 없어요.',
  'calendar.emptyQueryNote':
    '이미 시작했지만 이 날짜까지 이어지는 일정은 조회되지 않을 수 있어요.',
  'calendar.outsideQueryRange':
    '이 날짜는 캘린더 조회 기간 밖이라 일정이 모두 표시되지 않을 수 있어요.',
  'calendar.resultsMayBeIncomplete':
    '일정이 많아 일부 날짜의 일정이 표시되지 않았을 수 있어요.',
  'calendar.candidateHint':
    '목록의 일정은 모두 후보예요. Orot가 의료 일정으로 판단하지 않아요.',
  'calendar.selectEvent': '이 일정 선택',
  'calendar.confirmPrompt': '이 일정을 다음 외래 방문으로 확인할까요?',
  'calendar.reconfirmPrompt': '변경된 일정 정보를 확인한 뒤 다시 저장할까요?',
  'calendar.confirm': '다음 외래 방문으로 확인',
  'calendar.reconfirm': '변경된 일정으로 다시 확인',
  'calendar.saving': '저장 중…',
  'calendar.cancelSelection': '다른 일정 고르기',
  'calendar.confirmed': '다음 외래 방문을 저장했어요.',
  'calendar.loadError': '캘린더 일정을 불러오지 못했어요. 다시 시도해 주세요.',
  'calendar.verifyError':
    '연결한 캘린더 일정을 확인하지 못했어요. 다시 시도해 주세요.',
  'calendar.confirmError':
    '다음 외래 방문을 저장하지 못했어요. 다시 시도해 주세요.',
  'calendar.accessDenied':
    '캘린더 접근을 허용하지 않았어요. 설정에서 권한을 바꾼 뒤 다시 시도해 주세요.',
  'calendar.accessRestricted': '이 기기에서는 캘린더에 접근할 수 없어요.',
  'calendar.fullAccessRequired':
    '캘린더 일정을 읽으려면 전체 접근 권한이 필요해요. 설정에서 읽기 및 쓰기 접근을 허용해 주세요.',
  'calendar.tryAgainAfterPermission':
    '권한을 확인할 수 없어요. 다시 시도해 주세요.',
  'calendar.nextVisit': '다음 외래 방문',
  'calendar.eventNoTitle': '제목 없는 일정',
  'calendar.allDay': '하루 종일',
  'calendar.eventChanged':
    '연결한 캘린더 일정이 바뀌었어요. 변경 내용을 확인해 주세요.',
  'calendar.reviewChange': '변경 내용 확인',
  'calendar.eventMissing':
    '연결한 일정을 찾을 수 없어요. 삭제되었거나 일정 정보가 바뀌었을 수 있어요. 다른 일정을 선택해 확인해 주세요.',
  // Feature catalogs stay modular while the app uses one shared Korean lookup table.
  ...commonObservationsKo,
  ...bloodPressureKo,
  ...aiFeatureCatalogsKo,
  ...medicalAppointmentsKo,
  ...providerAccountsKo,
} as const;
