/** Delivery states describe observable requests, not a promise that a model obeyed. */
export const conversationSteeringKo = {
  'conversationSteering.failed':
    '추가 지시를 저장하지 못했어요. 입력한 내용은 그대로 두었어요.',
  'conversationSteering.send': '추가 지시 보내기',
  'conversationSteering.queued': '다음 처리 단계 대기 중',
  'conversationSteering.prepared': '다음 응답 요청 준비됨',
  'conversationSteering.applied': '응답 요청에 전달됨',
  'conversationSteering.not_applied': '반영되지 않음',
  'conversationSteering.notice':
    '진행 중인 요청은 바뀌지 않아요. 다음 처리 단계에서 반영하며, 답변이 먼저 끝나면 반영되지 않을 수 있어요.',
} as const;
