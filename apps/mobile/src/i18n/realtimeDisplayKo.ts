/** Fixed voice display and consent text only; permission and session guards remain in the voice owners. */
export const realtimeDisplayKo = {
  'realtimeDisplay.listening':
    '듣고 있어요. 잠시 멈추면 Realtime 모델이 답해요.',
  'realtimeDisplay.consentTitle': 'OpenAI Realtime로 통화할까요?',
  'realtimeDisplay.cancel': '취소',
  'realtimeDisplay.agree': '동의하고 시작',
  'realtimeDisplay.user': '나',
  'realtimeDisplay.consentBody':
    '{model}이 통화 음성과 대화 내용을 OpenAI API에서 처리하며 별도 API 사용료가 발생할 수 있어요. 건강정보 등 민감한 내용을 말하면 그 내용도 전송됩니다. 기존 기록·사진·이전 채팅은 보내지 않아요. 통화 내용은 이 화면에만 임시 표시하고 검증된 의료기록으로 저장하지 않아요. 시스템 통화가 연결되면 다른 앱을 사용하는 동안에도 계속돼요. 종료하거나 마이크를 끌 때까지 답변 중에도 계속 들어요.',
  'realtimeDisplay.pipeline': 'OpenAI {model} API 음성 처리 (기존 기록 미전송)',
  'realtimeDisplay.deviceTitle': '기기 음성 대화',
  'realtimeDisplay.realtimeTitle': '실시간 음성 대화',
} as const;
