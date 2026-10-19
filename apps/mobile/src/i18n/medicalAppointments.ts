/**
 * This feature-owned fragment is spread into the shared `ko` catalog in `ko.ts`.
 * The feature adapter resolves it with `t()` so keys and placeholders stay typed.
 */
export const medicalAppointmentsKo = {
  'medicalAppointments.failure.configuration':
    'AI 호출 전 실행 설정 검증에 실패했어요.',
  'medicalAppointments.failure.input': '일정에서 AI 요청을 구성하지 못했어요.',
  'medicalAppointments.failure.incompleteResponse':
    'AI가 응답 생성을 끝내지 못했어요.',
  'medicalAppointments.failure.malformedResponse':
    'AI 응답을 분류 결과로 읽지 못했어요.',
  'medicalAppointments.failure.citations':
    'AI 응답의 일정 참조가 요청한 일정과 맞지 않아요.',
  'medicalAppointments.failure.itemCount':
    'AI가 일부 일정의 분류를 빠뜨렸어요.',
  'medicalAppointments.failure.identity':
    'AI가 일정 번호를 중복하거나 잘못 반환했어요.',
  'medicalAppointments.failure.fields':
    'AI가 분류 값이나 설명을 올바르게 반환하지 못했어요.',
  'medicalAppointments.failure.validation':
    'AI 응답에 빠지거나 중복된 일정, 또는 잘못된 분류 값이 있어요.',
  'medicalAppointments.failure.summary':
    '{batch}번째 묶음 처리 중 {seconds}초 후 중단됐어요. {reason} 완료한 분류는 유지했어요.',
  'medicalAppointments.failure.budget':
    'AI 처리 시간 또는 요청 크기 한도에 도달했어요.',
  'medicalAppointments.failure.changed':
    '분류 중 원본 일정이 바뀌었거나 다시 확인하지 못했어요.',
  'medicalAppointments.failure.consent': '이 요청의 AI 처리 승인이 필요해요.',
  'medicalAppointments.failure.response':
    'AI 응답에서 모든 일정의 분류 결과를 확인하지 못했어요.',
  'medicalAppointments.failure.provider': '선택한 AI의 응답을 받지 못했어요.',
  'medicalAppointments.title': '진료 일정 분류',
  'medicalAppointments.description': '캘린더에서 병원 일정을 찾아 가져와요.',
  'medicalAppointments.queryLimit':
    '향후 1년의 캘린더 일정을 건수 제한 없이 확인해요.',
  'medicalAppointments.incompleteCalendar':
    '일부 일정을 읽지 못해 전체 조회 범위를 확인하지 못했어요.',
  'medicalAppointments.localNotice': '기기 안에서 분류해요.',
  'medicalAppointments.remoteNotice':
    '원격 제공자를 선택하면 일정 제목과 시간은 별도 동의 후 전송됩니다.',
  'medicalAppointments.inferenceDisclosure.title':
    '전송 전에 내용을 확인해 주세요',
  'medicalAppointments.inferenceDisclosure.service': '서비스',
  'medicalAppointments.inferenceDisclosure.recipient': '받는 곳',
  'medicalAppointments.inferenceDisclosure.model': '모델',
  'medicalAppointments.inferenceDisclosure.privacyBoundary':
    '이 승인은 아래 요청의 원격 추론만 허용하며 외부 추적 동의와는 별개입니다.',
  'medicalAppointments.inferenceDisclosure.sentMessages': '전송할 대화',
  'medicalAppointments.inferenceDisclosure.role.system': '시스템 지침',
  'medicalAppointments.inferenceDisclosure.role.user': '사용자 내용',
  'medicalAppointments.inferenceDisclosure.role.assistant': '모델 대화',
  'medicalAppointments.inferenceDisclosure.role.tool': '도구 결과',
  'medicalAppointments.inferenceDisclosure.toolCalls': '도구 호출:',
  'medicalAppointments.inferenceDisclosure.tools': '사용 가능한 도구 정의',
  'medicalAppointments.inferenceDisclosure.responseFormat': '응답 형식',
  'medicalAppointments.inferenceDisclosure.settings': '생성 설정',
  'medicalAppointments.inferenceDisclosure.previewUnavailable':
    '[이 데이터를 안전하게 미리 볼 수 없습니다]',
  'medicalAppointments.inferenceDisclosure.attachmentUnavailable':
    '[{type} 첨부 내용을 이 화면에서 확인할 수 없습니다]',
  'medicalAppointments.inferenceDisclosure.blockedAttachment':
    '첨부 내용을 미리 볼 수 없어 전송을 허용할 수 없습니다.',
  'medicalAppointments.inferenceDisclosure.allow': '이 내용 전송 허용',
  'medicalAppointments.inferenceDisclosure.cancel': '취소',
  'medicalAppointments.actions.loadCalendar': '선택한 AI로 분류',
  'medicalAppointments.actions.classify': '선택한 AI로 분류',
  'medicalAppointments.actions.manual': '일정 직접 입력',
  'medicalAppointments.status.loading': '캘린더 일정을 불러오는 중입니다.',
  'medicalAppointments.status.classifying': '일정을 분류하고 있습니다.',
  'medicalAppointments.status.noCandidates': '불러온 일정이 없습니다.',
  'medicalAppointments.status.permissionUnavailable':
    '캘린더 읽기 권한이 필요해요. 설정에서 권한을 확인하거나 직접 일정을 입력할 수 있어요.',
  'medicalAppointments.status.calendarSyncing':
    '캘린더에서 일정을 확인하고 있어요.',
  'medicalAppointments.status.calendarSyncError':
    '캘린더 일정을 확인하지 못했어요. 설정에서 상태를 확인해 주세요.',
  'medicalAppointments.actions.calendarSettings': '캘린더 설정 열기',
  'medicalAppointments.status.providerUnavailable':
    '선택된 AI를 사용할 수 없습니다. 수동으로 일정을 확인할 수 있습니다.',
  // Provider lookup can finish asynchronously; manual entry remains available meanwhile.
  'medicalAppointments.status.providerResolving':
    '선택한 AI를 확인하고 있어요.',
  'medicalAppointments.status.noProvider':
    'AI를 분류에 사용하려면 선택한 제공자와 실행 정보가 필요합니다.',
  'medicalAppointments.status.emptyCoverage': '조회한 기간에 일정이 없어요.',
  'medicalAppointments.status.manualReview':
    '일부 일정을 분류하지 못했어요. 다시 시도하거나 직접 입력해 주세요.',
  'medicalAppointments.status.noMedical': '진료 일정으로 분류된 일정이 없어요.',
  'medicalAppointments.status.imported': '진료 일정 {count}건을 가져왔어요.',
  'medicalAppointments.status.preserved':
    '취소하거나 완료한 일정 {count}건은 그대로 유지했어요.',
  'medicalAppointments.status.notClassified': '아직 분류하지 않았습니다.',
  'medicalAppointments.actions.save': '진료 일정으로 추가',
  'medicalAppointments.actions.saving': '저장 중입니다.',
  'medicalAppointments.status.saved': '일정을 저장했습니다.',
  'medicalAppointments.status.stale':
    '일정이나 권한이 바뀌었습니다. 다시 불러온 뒤 확인해 주세요.',
  'medicalAppointments.status.saveError': '일정을 저장하지 못했습니다.',
  'medicalAppointments.resultNotice':
    '분류 결과는 참고용이며 진단이나 의료 조언이 아닙니다.',
  'medicalAppointments.uncertainty': '불확실성',
  'medicalAppointments.reason': '분류 근거',
  'medicalAppointments.unclassified': '미분류',
  'medicalAppointments.coverage':
    '불러온 일정 {returned}건 중 {classified}건을 분류했습니다.',
  'medicalAppointments.coverageComplete': '일정 {returned}건 · 분류 완료',
  'medicalAppointments.labels.medical': '진료 일정',
  'medicalAppointments.labels.nonMedical': '진료 일정 아님',
  'medicalAppointments.labels.uncertain': '불확실',
  'medicalAppointments.labels.low': '낮음',
  'medicalAppointments.labels.medium': '보통',
  'medicalAppointments.labels.high': '높음',
} as const;
