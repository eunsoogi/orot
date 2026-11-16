/** Delivery states describe observable requests, not a promise that a model obeyed. */
export const conversationSteeringKo = {
  'conversationSteering.failed':
    '추가 지시를 저장하지 못했어요. 입력한 내용은 그대로 두었어요.',
  'conversationSteering.delivery_pending': '전달 미확인',
  'conversationSteering.send': '추가 지시 보내기',
  'conversationSteering.queued': '전달 대기 중',
  'conversationSteering.prepared': '다음 응답 요청 준비됨',
  'conversationSteering.applied': '응답 요청에 전달됨',
  'conversationSteering.not_applied': '전달되지 않음 · 다시 보내주세요',
  'conversationSteering.live_notice':
    '지금 생성 중인 답변에 추가 지시를 보낼 수 있어요. 실시간 반영은 이 응답에서 한 번 지원해요.',
  'conversationSteering.limit_notice':
    '이 응답의 실시간 추가 지시 전송 기회를 사용했어요. 실제 전달 상태는 아래에서 확인해 주세요. 이후 지시는 다음 처리 단계에서 전달돼요.',
  'conversationSteering.notice':
    '추가 지시는 다음 처리 단계에서 전달돼요. 실시간 전송이 준비되면 따로 표시하고, 전달하지 못한 지시도 구분해요.',
} as const;
