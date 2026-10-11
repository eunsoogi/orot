/**
 * This feature-owned fragment is spread into the shared `ko` catalog in `ko.ts`.
 * The feature adapter resolves it with `t()` so keys and placeholders stay typed.
 */
export const medicalAppointmentsKo = {
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
  'medicalAppointments.actions.loadCalendar': '캘린더에서 진료 일정 가져오기',
  'medicalAppointments.actions.classify': '선택한 AI로 분류',
  'medicalAppointments.actions.manual': '일정 직접 입력',
  'medicalAppointments.status.loading': '캘린더 일정을 불러오는 중입니다.',
  'medicalAppointments.status.classifying': '일정을 분류하고 있습니다.',
  'medicalAppointments.status.noCandidates': '불러온 일정이 없습니다.',
  'medicalAppointments.status.permissionUnavailable':
    '캘린더 읽기 권한을 사용할 수 없습니다. 직접 일정을 입력할 수 있습니다.',
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
