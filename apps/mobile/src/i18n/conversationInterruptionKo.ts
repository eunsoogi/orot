/** Bounded lifecycle reasons never include provider payloads or private records. */
export const conversationInterruptionKo = {
  'conversationInterruption.decision-required':
    '확인이 필요해 응답을 잠시 중단했어요. 앱에서 내용을 검토하고 이어가 주세요.',
  'conversationInterruption.reviewAction': '질문 검토 후 이어하기',
  'conversationInterruption.reviewNotice':
    '이전 작업은 중단됐어요. 이 버튼은 질문을 입력창에 가져오며 자동으로 실행하지 않아요. 이미 완료된 작업과 남은 내용을 확인하고 다시 보내 주세요.',
  'conversationInterruption.reviewAttachment':
    '사진이 포함된 질문은 첨부와 전송 동의를 다시 확인해 주세요.',
  'conversationInterruption.reviewDraftConflict':
    '작성 중인 다른 질문을 지우지 않도록 입력창을 그대로 두었어요.',

  'conversationInterruption.user-stopped': '답변 생성을 중지했어요.',
  'conversationInterruption.provider-failed':
    '답변을 완료하지 못했어요. 연결 상태와 남은 내용을 확인한 뒤 다시 보내 주세요.',
  'conversationInterruption.process-interrupted':
    '이전 실행에서 답변을 완료하지 못했어요. 남은 내용을 확인한 뒤 다시 보내 주세요.',
  'conversationInterruption.expired':
    'iOS 백그라운드 실행 시간이 끝나 답변이 중단됐어요. 돌아온 뒤 내용을 확인하고 다시 보내 주세요.',
  'conversationInterruption.protected-data':
    '보호된 데이터에 접근할 수 없어 답변을 멈췄어요. 기기 잠금을 해제하고 앱으로 돌아온 뒤 다시 보내 주세요.',
  'conversationInterruption.bridge-unavailable':
    '이 앱에서 백그라운드 실행을 연결하지 못했어요. 앱을 열어 둔 상태로 다시 보내 주세요.',
  'conversationInterruption.lease-denied':
    'iOS가 백그라운드 실행을 허용하지 않아 답변을 시작하지 못했어요. 앱을 연 상태에서 다시 보내 주세요.',
  'conversationInterruption.lease-check-failed':
    '실행 가능 상태를 확인하지 못해 답변을 멈췄어요. 앱을 연 상태에서 다시 보내 주세요.',
} as const;
