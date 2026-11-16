/** Delivery states describe observable requests, not a promise that a model obeyed. */
export const conversationSteeringKo = {
  'conversationSteering.failed':
    '추가 지시를 저장하지 못했어요. 입력한 내용은 그대로 두었어요.',
  'conversationSteering.send': '추가 지시 보내기',
  'conversationSteering.queued': '다음 처리 단계 대기 중',
  'conversationSteering.prepared': '다음 응답 요청 준비됨',
  'conversationSteering.applied': '응답 요청에 전달됨',
  'conversationSteering.not_applied': '전달되지 않음 · 다시 보내주세요',
  'conversationSteering.notice':
    '입력 후 전송하면 진행 중인 대화에 추가해요. 다음 응답 처리에 전달하며, 처리 한도나 이미 완료된 작업 때문에 전달하지 못하면 따로 표시해요.',
} as const;
