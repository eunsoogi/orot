/** Bounded lifecycle reasons never include provider payloads or private records. */
export const conversationInterruptionKo = {
  'conversationInterruption.restartAction': '새 요청으로 다시 시작',
  'conversationInterruption.restartTitle': '새 요청을 시작할까요?',
  'conversationInterruption.restartWarning':
    '저장 지점에서 이어가는 것이 아니라 같은 질문을 새로 보냅니다. 추가 API 비용이 발생할 수 있고, 이전 요청의 저장·변경 작업이 이미 완료됐다면 중복될 수 있어요. 기록을 확인한 뒤 선택해 주세요.',
  'conversationInterruption.cancelRestart': '취소',
  'conversationInterruption.reattach':
    '사진이 포함된 질문은 사진을 다시 첨부하고 내용을 확인한 뒤 새로 보내 주세요.',

  'conversationInterruption.checkNotice':
    '답변이 중단됐어요. 저장된 진행 상황을 확인할 수 있어요. 완료 여부가 불확실한 작업은 반복하지 않아요.',
  'conversationInterruption.checkAction': '저장된 진행 확인',
  'conversationInterruption.checking': '진행 상황 확인 중',
  'conversationInterruption.resumeUnavailable':
    '지금 이어갈 수 있는 저장 지점이 없어요. 작성한 질문은 유지되며, 완료 여부가 불확실한 작업은 다시 실행하지 않아요.',
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
