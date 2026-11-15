/** Bounded lifecycle reasons never include provider payloads or private records. */
export const conversationInterruptionKo = {
  'conversationInterruption.resumeUnavailable':
    '안전하게 이어갈 수 있는 실행 상태를 찾지 못했어요. 완료 여부가 불확실한 작업은 다시 실행하지 않아요.',
  'conversationInterruption.pausedNotice':
    '작업이 안전한 저장 지점에서 멈췄어요. 완료한 도구를 반복하지 않고 이어갈 수 있어요.',
  'conversationInterruption.resumeAction': '작업 이어하기',
  'conversationInterruption.decision-required':
    '확인이 필요해 응답을 잠시 중단했어요. 앱에서 내용을 검토하고 이어가 주세요.',
  'conversationInterruption.user-stopped': '답변 생성을 중지했어요.',
  'conversationInterruption.provider-failed':
    '답변을 완료하지 못했어요. 연결 상태와 저장된 진행 상황을 확인해 주세요.',
  'conversationInterruption.process-interrupted':
    '이전 실행에서 답변을 완료하지 못했어요. 완료 여부가 불확실한 작업은 자동으로 다시 실행하지 않아요.',
  'conversationInterruption.expired':
    'iOS 백그라운드 실행 시간이 끝나 답변이 중단됐어요. 안전한 저장 지점이 있으면 작업 이어하기가 표시돼요.',
  'conversationInterruption.protected-data':
    '보호된 데이터에 접근할 수 없어 답변을 멈췄어요. 기기 잠금을 해제하고 저장된 진행 상황을 확인해 주세요.',
  'conversationInterruption.bridge-unavailable':
    '이 앱에서 백그라운드 실행을 연결하지 못했어요. 앱을 열어 둔 상태에서 진행 상황을 확인해 주세요.',
  'conversationInterruption.lease-denied':
    'iOS가 백그라운드 실행을 허용하지 않아 답변을 시작하지 못했어요. 앱을 연 상태에서 진행 상황을 확인해 주세요.',
  'conversationInterruption.lease-check-failed':
    '실행 가능 상태를 확인하지 못해 답변을 멈췄어요. 저장된 진행 상황을 확인해 주세요.',
} as const;
