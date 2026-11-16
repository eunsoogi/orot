/** One-shot voice delegation and cross-recipient result disclosure. */
export const realtimeToolConsentKo = {
  'realtimeToolConsent.returnToCall': '통화 화면으로 돌아가기',
  'realtimeToolConsent.enable': '도구도 확인하며 사용',
  'realtimeToolConsent.explanation':
    '도구를 사용하면 인식한 문장과 처리 서비스를 먼저 확인해요. 기존 대화의 저장·추가 비용·기록 및 작업 승인이 적용되며, 결과를 OpenAI Realtime으로 보내기 전 다시 확인해요.',
  'realtimeToolConsent.title': '이 요청을 실행할까요?',
  'realtimeToolConsent.recognized': '인식한 요청',
  'realtimeToolConsent.recipient': '처리할 제공자: {recipient}',
  'realtimeToolConsent.model': '선택한 모델: {model}',
  'realtimeToolConsent.effects':
    '이 요청은 선택한 모델로 실행하고 앱 대화에 저장해요. 제공자에 따라 추가 사용료가 발생할 수 있어요. 건강 기록 전송이나 기록 변경 등 기존 작업의 승인은 별도로 유지돼요.',
  'realtimeToolConsent.correction':
    '인식한 말이 다르면 취소하고 다시 말해 주세요. 요청을 자동으로 고치지 않아요.',
  'realtimeToolConsent.resultBoundary':
    '이 승인은 실행에만 해당해요. 결과를 OpenAI Realtime로 보내 음성으로 답하게 하려면 결과 내용을 보고 다시 승인해야 해요.',
  'realtimeToolConsent.allow': '이 요청 실행',
  'realtimeToolConsent.cancel': '취소',
  'realtimeToolConsent.resultPurpose':
    'OpenAI Realtime 음성 응답을 위해 아래 결과를 OpenAI로 전송할까요?',
  'realtimeToolConsent.resultInformation':
    '아래에 표시된 정확한 결과 내용만 이번 한 번 전송해요. 이전의 목적별 허용은 이 전송에 적용하지 않아요.',
} as const;
