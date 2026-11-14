/** Bounded lifecycle reasons never include provider payloads or private records. */
export const conversationInterruptionKo = {
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
