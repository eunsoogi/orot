import { commonObservationsKo } from './healthkitCommonObservations';
import { bloodPressureKo } from './healthkitBloodPressure';

export const ko = {
  // These strings describe local restore preparation, not an OS backup result.
  'backup.title': 'iCloud 기기 백업 준비',
  'backup.description':
    '암호화된 Orot 기록과 상담 녹음이 기기 백업에 포함될 수 있도록 준비해요. 앱은 실제 백업 완료 여부를 확인할 수 없어요.',
  'backup.status.checking': '백업 준비 상태를 확인하고 있어요.',
  'backup.status.ready':
    '백업을 위한 데이터 준비를 마쳤어요. iOS 설정에서 iCloud 백업을 켜고 Orot가 포함되어 있는지 확인해 주세요.',
  'backup.status.recoveryRequired':
    '기존 암호화 기록이나 복원 키를 확인할 수 없어 새 데이터베이스를 만들지 않았어요. 이전 기기 백업과 잠금 해제 상태를 확인해 주세요.',
  'backup.status.unavailable':
    '백업 준비 상태를 확인하지 못했어요. 기기를 잠금 해제한 뒤 다시 시도하고, iCloud 저장 공간은 설정에서 확인해 주세요.',
  'backup.settingsPath': '설정 > 사용자 이름 > iCloud > iCloud 백업',
  'backup.retry': '다시 확인',
  'app.welcome.title': 'Orot에 오신 걸 환영해요',
  'app.welcome.message': 'Orot의 첫걸음이에요.',
  'app.welcome.started': '이제 시작할 수 있어요.',
  'app.actions.getStarted': '시작하기',
  'app.actions.appointments': '예약',
  'app.actions.recording': '상담 녹음',
  'recording.title': '상담 녹음',
  'recording.back': '뒤로',
  'recording.consent.description':
    '녹음 전에 상담 참여자 모두에게 녹음 사실을 알리고 동의를 받아 주세요.',
  'recording.consent.acknowledgement':
    '참여자에게 녹음 사실을 알리고 동의를 받았습니다.',
  'recording.localOnly':
    '녹음 파일은 이 기기에 보관되고 Orot 서버로 전송되지 않습니다.',
  'recording.status.idle': '녹음하지 않음',
  'recording.status.recording': '녹음 중',
  'recording.status.paused': '일시 정지됨',
  'recording.status.interrupted': '오디오가 중단되어 녹음이 일시 정지됨',
  'recording.status.completed': '녹음 저장됨',
  'recording.duration': '녹음 시간: {duration}',
  'recording.id': '녹음 ID: {id}',
  'recording.start': '녹음 시작',
  'recording.pause': '일시 정지',
  'recording.resume': '녹음 재개',
  'recording.stop': '녹음 완료 및 저장',
  'recording.saved': '녹음을 이 기기에 저장했어요.',
  'recording.sourcePending':
    '녹음 파일은 이 기기에 보관 중이에요. 기록 연결을 다시 저장한 뒤 화면을 나갈 수 있어요.',
  'recording.retrySave': '기록 다시 저장',
  'recording.errors.consent':
    '녹음을 시작하기 전에 앱에서 동의를 확인해 주세요.',
  'recording.errors.microphonePermission':
    '마이크 권한이 필요해요. 설정에서 권한을 허용한 뒤 다시 시도해 주세요.',
  'recording.errors.sourceSave':
    '녹음 파일은 이 기기에 남아 있어요. 기록 연결을 다시 시도해 주세요.',
  'recording.errors.fileProtection':
    '녹음 파일 보호 또는 기기 백업 포함 여부를 확인하지 못해 기록 연결을 보류했어요. 파일은 이 기기에 남아 있습니다.',
  'recording.errors.generic':
    '녹음 상태를 처리하지 못했어요. 다시 시도해 주세요.',
  'recording.transcript.title': '전사 검토',
  'recording.transcript.localOnly':
    '전사는 Apple 기기 내 음성 인식으로 처리하고 서버로 보내지 않습니다.',
  'recording.transcript.description':
    '자동 전사는 검토 전 초안이에요. 오디오 구간을 듣고 필요한 내용을 수정해 주세요.',
  'recording.transcript.correctionNotice':
    '전사문은 검토 전 초안이에요. 오디오와 대조하고 필요한 내용을 수정해 주세요.',
  'recording.transcript.loading': '전사 기록을 불러오는 중…',
  'recording.transcript.noRecording': '전사할 수 있는 녹음이 없어요.',
  'recording.transcript.empty': '이 녹음에는 저장된 전사 내용이 없어요.',
  'recording.transcript.create': '이 녹음 전사하기',
  'recording.transcript.creating': '기기에서 전사 중…',
  'recording.transcript.error.load': '전사 기록을 불러오지 못했어요.',
  'recording.transcript.error.create':
    '녹음을 전사하지 못했어요. 기기 지원 상태를 확인해 주세요.',
  'recording.transcript.error.correct': '수정 내용을 저장하지 못했어요.',
  'recording.transcript.error.play': '오디오 구간을 재생하지 못했어요.',
  'recording.transcript.engine': '엔진: {engine}',
  'recording.transcript.runtime': '시스템 버전: {version}',
  'recording.transcript.range': '{start}–{end}',
  'recording.transcript.play': '이 구간 듣기',
  'recording.transcript.playing': '구간 재생 중…',
  'recording.transcript.review.unreviewed': '검토 전 초안',
  'recording.transcript.review.needsReview': '수정됨 · 다시 확인 필요',
  'recording.transcript.review.reviewed': '검토됨',
  'recording.transcript.origin.machine': '기계 전사',
  'recording.transcript.origin.userCorrection': '사용자 수정',
  'recording.transcript.verification.clinicianNotRecorded':
    '의료진 확인 기록 없음',
  'recording.transcript.edit': '수정',
  'recording.transcript.input.label': '전사 내용',
  'recording.transcript.save': '수정 저장',
  'recording.transcript.cancel': '취소',
  'recording.transcript.history': '이전 버전 {revision}: {text}',
  'recording.transcript.staleArtifacts':
    '수정으로 관련 파생 자료 {count}개가 다시 확인 대기 상태예요.',
  'recording.probe.synthetic': '시뮬레이터용 합성 녹음 준비',
  'recording.probe.failBeforeFile': '파일 준비 전 실패 시뮬레이션',
  'recording.probe.failAfterFile': '임시 파일 생성 후 실패 시뮬레이션',
  'recording.probe.interruptionBegan': '중단 시작 시뮬레이션',
  'recording.probe.interruptionEnded': '중단 종료 시뮬레이션',
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
  'calendar.empty': '다가오는 일정이 없어요.',
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
  ...commonObservationsKo,
  ...bloodPressureKo,
  'provider.apple.available':
    '이 기기에서 Apple Intelligence를 사용할 수 있어요.',
  'provider.apple.disabled': '설정에서 Apple Intelligence를 켜 주세요.',
  'provider.apple.modelNotReady': 'Apple Intelligence 모델을 준비하고 있어요.',
  'provider.apple.unsupportedDevice':
    '이 기기에서는 Apple Intelligence를 사용할 수 없어요.',
  'provider.apple.unsupportedLanguage': '현재 한국어를 지원하지 않아요.',
  'provider.apple.generationFailed':
    '질문을 만들지 못했어요. 다시 시도해 주세요.',
  'provider.selection.title': '추천에 사용할 AI 선택',
  'provider.selection.introduction':
    '사용할 AI를 직접 선택하세요. 선택한 AI를 사용할 수 없으면 다른 AI로 자동 전환하지 않아요.',
  'provider.selection.selectPrompt':
    '아직 AI를 선택하지 않았어요. 사용할 AI를 직접 골라 주세요.',
  'provider.selection.unavailableSelection':
    '이전에 선택한 AI를 사용할 수 없어요. 자동으로 다른 AI를 고르지 않았습니다.',
  'provider.selection.selectedPrefix': '현재 선택:',
  'provider.selection.onDeviceHeading': '기기 내 처리',
  'provider.selection.onDevicePrivacy':
    '질문과 선택한 기록은 기기에서 처리돼요. Apple Intelligence 사용 가능 여부는 기기와 언어 설정에 따라 달라질 수 있어요.',
  'provider.selection.remoteHeading': 'OpenAI로 선택한 내용 전송',
  'provider.selection.remotePrivacy':
    '질문과 직접 선택한 기록이 OpenAI로 전송돼 처리돼요. 전송할 기록을 확인하고 OpenAI 서비스 정책을 확인해 주세요.',
  'provider.selection.unsupportedCapabilities':
    '이 AI는 추천 흐름에 필요한 기능을 지원하지 않아 선택할 수 없어요.',
  'provider.selection.storageLoadError': '저장된 AI 선택을 불러오지 못했어요.',
  'provider.selection.storageSaveError':
    'AI 선택을 저장하지 못했어요. 다시 시도해 주세요.',
  'provider.selection.confirmApple': '이 기기에서 처리하도록 선택',
  'provider.selection.confirmRemote': '원격 처리에 동의하고 선택 저장',
  'provider.selection.cancel': '취소',
  'provider.selection.unavailableProvider': '현재 사용할 수 없어요.',
  'provider.selection.appleStatusError':
    'Apple Intelligence 상태를 확인하지 못했어요.',
  'provider.selection.appleDisabled':
    '기기 설정에서 Apple Intelligence를 켜 주세요.',
  'provider.selection.appleModelNotReady':
    'Apple Intelligence 모델을 준비하고 있어요.',
  'provider.selection.appleUnsupportedDevice':
    '이 기기에서는 Apple Intelligence를 사용할 수 없어요.',
  'provider.selection.appleUnsupportedLanguage':
    '현재 언어 설정에서는 Apple Intelligence를 사용할 수 없어요.',
  'provider.selection.chatGPTAccountRequired':
    'ChatGPT 계정과 사용 가능한 모델을 확인해야 선택할 수 있어요.',
  'provider.selection.chatGPTAccountReadError':
    'ChatGPT 로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  'provider.selection.chatGPTNoAccounts':
    'ChatGPT 계정을 연결하면 모델 목록을 확인할 수 있어요.',
  'provider.selection.chatGPTAccountSignedIn': '저장된 ChatGPT 계정이에요.',
  'provider.selection.chatGPTAccountSignedOut':
    '다시 로그인해야 사용할 수 있어요.',
  'provider.selection.chatGPTAccountMissingScope':
    'ChatGPT 직접 사용 권한이 없어 다시 로그인해 권한을 확인해야 해요.',
  'provider.selection.chatGPTChooseAccount':
    '사용할 ChatGPT 계정을 먼저 골라 주세요.',
  'provider.selection.chatGPTSignIn': 'ChatGPT 로그인',
  'provider.selection.chatGPTReauthorize': 'ChatGPT 다시 로그인',
  'provider.selection.chatGPTLoadModels': '선택한 계정의 모델 목록 불러오기',
  'provider.selection.chatGPTCancelLogin': 'ChatGPT 로그인 취소',
  'provider.selection.chatGPTChecking': 'ChatGPT 계정 상태를 확인하고 있어요.',
  'provider.selection.chatGPTLoginSuccess':
    '로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요.',
  'provider.selection.chatGPTModelsLoaded': 'ChatGPT 모델 목록을 확인했어요.',
  'provider.selection.chatGPTModelsUnavailable':
    'ChatGPT 모델 목록을 확인하지 못했어요. 로그인 상태와 권한을 확인해 주세요.',
  'provider.selection.chatGPTLoginCancelled': 'ChatGPT 로그인을 취소했어요.',
  'provider.selection.back': '돌아가기',
} as const;
