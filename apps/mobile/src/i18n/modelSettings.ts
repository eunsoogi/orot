/** App-owned model settings copy; privacy and billing notices retain their original meaning. */
export const modelSettingsKo = {
  'modelSettings.consentWeb':
    '{recipient}에 공개 웹 검색용으로 검토된 검색어를 보내는 데 별도로 계속 동의합니다.',
  'modelSettings.consentMedical':
    'Europe PMC에 의학 문헌 검색어를 보내는 데 별도로 계속 동의합니다. 건강 기록 원문이나 대화 전체는 보내지 않습니다.',
  'modelSettings.consentRecipient': '전송받는 곳: {recipient}',
  'modelSettings.consentConversationData':
    '대화와 보고서 생성에 필요한 질문, 선택한 건강 기록·검토한 기억·이전 대화·생성 결과, 진료 예약과 질문, 녹음 전사문, 사진에서 읽은 텍스트, 일정 계획 및 검색 결과를 전송합니다. 원본 사진은 전송하지 않습니다.',
  'modelSettings.consentCalendarData':
    '일정의 진료 관련성을 분류하기 위해 캘린더 일정 제목과 시간을 전송합니다.',
  'modelSettings.consentVoiceData':
    '선택한 음성 모델로 통화할 때 건강정보를 포함해 말한 실시간 음성과 대화 내용, 요청한 대화 AI의 답변을 전송합니다. 원본 기록·사진·이전 채팅은 직접 보내지 않습니다. 별도 API 사용료가 발생할 수 있습니다. 통화 내용은 임시 표시되며 검증된 의료기록으로 자동 저장되지 않습니다. 시스템 통화가 연결되면 다른 앱을 사용하는 동안에도 계속되며 종료하거나 마이크를 끌 때까지 답변 중에도 듣습니다. 마이크 접근과 기록 변경 등 별도 행동 승인은 유지됩니다.',
  'modelSettings.liveVoiceConsentTitle': 'OpenAI Live 음성 대화에 동의할까요?',
  'modelSettings.liveVoiceConsentScope':
    '통화 중 말한 음성과 이 통화의 대화만 전송해요.',
  'modelSettings.liveVoiceConsentNotice':
    '같은 계정과 모델로 음성 대화를 시작할 때 다시 묻지 않아요. 모델 설정에서 동의를 변경할 수 있어요.',
  'modelSettings.liveVoiceProcessing':
    'OpenAI Live API에서 음성 대화를 처리해요.',
  'modelSettings.liveVoiceUnselected': '선택',
  'modelSettings.liveVoicePreferenceLoading': '음성 설정을 불러오는 중이에요.',
  'modelSettings.liveVoicePreferenceUnavailable':
    '저장된 음성 설정을 사용할 수 없어요.',
  'modelSettings.liveVoiceLanguage': '목소리 언어',
  'modelSettings.liveVoiceName': '목소리',
  'modelSettings.liveVoiceSavedLabel': '저장된 목소리: {voice}',
  'modelSettings.liveVoicePreferenceSaveFailed':
    '음성 설정을 저장하지 못했어요.',
  'modelSettings.liveVoiceLegacyCurrent': '기존 OpenAI 음성 설정 (전환 필요)',
  'modelSettings.liveVoiceUnavailableNoFallback':
    'GPT-Live-1.1로 연결할 수 없어요. 기존 음성 모델로 자동 전환하지 않아요.',
  'modelSettings.liveVoiceDefaultVoice': '기본값 (Marin)',
  'modelSettings.liveVoiceNoeul': '노을 · 한국어',
  'modelSettings.liveVoiceQuartz': 'Quartz · 영어(호주)',
  'modelSettings.liveVoiceLegacyTitle': '음성 모델 변경 필요',
  'modelSettings.liveVoiceLegacyAction':
    '음성 설정에서 GPT-Live-1.1을 선택해 주세요.',
  'modelSettings.liveVoiceLanguageKorean': '한국어',
  'modelSettings.liveVoiceLanguageEnglish': '영어',
  'modelSettings.liveVoiceLanguagePortuguese': '포르투갈어',
  'modelSettings.liveVoiceLanguageGerman': '독일어',
  'modelSettings.liveVoiceLanguageFrench': '프랑스어',
  'modelSettings.liveVoiceLanguageHindi': '힌디어',
  'modelSettings.liveVoiceLanguageJapanese': '일본어',
  'modelSettings.consentContinuing':
    '모델 선택을 확인하면 이 계정과 모델의 위 전송 범위에 계속 동의합니다. 같은 범위의 새 기록도 포함하며 채팅마다 다시 묻지 않습니다. 모델 설정에서 철회할 수 있고 계정·모델·전송 범위가 바뀌면 다시 동의해야 합니다. 공개 검색의 별도 수신자에게는 이 동의가 적용되지 않습니다.',

  'modelSettings.decisionsUnavailable':
    '이 앱에서 OpenAI API 분류 모델을 사용할 수 없어요.',
  'modelSettings.calendarTab': '일정 분류 모델',
  'modelSettings.calendarPurpose':
    '캘린더 일정의 진료 관련성을 분류할 모델이에요. 대화 모델은 바뀌지 않아요.',
  'modelSettings.calendarUnselected': '일정 분류 모델을 선택해 주세요.',
  'modelSettings.apiUsageCost':
    '이 모델을 사용하면 별도 OpenAI API 사용료가 청구돼요.',
  'modelSettings.decisionsNotice':
    'OpenAI API의 Decisions 모델만 표시해요. API 사용료는 별도로 청구돼요.',
  'modelSettings.noDecisionModels':
    '이 계정에서 확인된 지원 Decisions 모델이 없어요.',

  'modelSettings.confirmLanguage': '이 AI 사용',
  'modelSettings.languageTab': '대화 모델',
  'modelSettings.voiceTab': '보이스 모델',
  'modelSettings.languageTitle': 'AI 선택',
  'modelSettings.languagePrompt': '질문에 답할 AI를 선택해 주세요.',
  'modelSettings.localProcessing': '기기 안에서 처리',
  'modelSettings.logoutConfirmation':
    '이 계정에서 로그아웃할까요? 저장된 기록은 유지됩니다.',
  'modelSettings.cancel': '취소',
  'modelSettings.logout': '로그아웃',
  'modelSettings.refreshModels': '모델 새로고침',
  'modelSettings.chatgptAccount': 'ChatGPT 계정 관리',
  'modelSettings.manageAccount': '계정 관리',
  'modelSettings.apiAccountInfo': 'OpenAI API 계정 정보',
  'modelSettings.apiConnected': 'API 계정 연결됨',
  'modelSettings.apiRequired': 'API 계정 연결 필요',
  'modelSettings.refreshVoice': '음성 모델 새로고침',
  'modelSettings.manageApi': 'OpenAI API 연결 관리',
  'modelSettings.confirmVoice': '이 보이스 사용',
  'modelSettings.currentSelection': '현재 선택:',
  'modelSettings.voiceConsent':
    '통화를 시작할 때 마이크 사용과 OpenAI로의 음성 전송에 별도로 동의해야 합니다. 설정 저장만으로 키를 확인하거나 음성을 전송하지 않습니다.',
  'modelSettings.voiceUnavailable':
    '이 빌드에는 Realtime 통화 기능이 없어 설정만 저장할 수 있습니다. 통화를 시작할 수 없으며, 기기 내 처리로 자동 전환하지 않습니다.',
  'modelSettings.apiReadFailed':
    'API 계정을 읽지 못했습니다. 화면을 다시 열어 주세요.',
  'modelSettings.apiDisconnected':
    'API 연결을 해제했습니다. 저장된 음성 모델 선택은 유지됩니다. 로컬 모델로 자동 전환하지 않습니다.',
  'modelSettings.apiSaved':
    'API 키를 저장했습니다. 음성 모델 설정에서 목록을 새로고침해 주세요.',
  'modelSettings.apiSaveFailed':
    'API 키를 저장하지 못했습니다. 기존 연결은 유지됩니다.',
  'modelSettings.keyConnected': 'API 키 연결됨',
  'modelSettings.keyDisconnected': 'API 키 연결 안 됨',
  'modelSettings.editApiKey': 'OpenAI API 키 수정',
  'modelSettings.logoutApi': 'OpenAI API 로그아웃',
  'modelSettings.apiKey': 'OpenAI API 키',
  'modelSettings.replaceKey': '변경할 API 키 입력',
  'modelSettings.enterKey': 'API 키 입력',
  'modelSettings.saveKey': 'API 키 저장',
  'modelSettings.disconnectApi': 'OpenAI API 연결 해제',
  'modelSettings.voiceReadFailed':
    '음성 설정을 읽지 못했습니다. 화면을 다시 열어 주세요.',
  'modelSettings.voiceSaved':
    '음성 설정을 저장했습니다. 통화는 대화 화면에서 별도로 시작해 주세요.',
  'modelSettings.voiceSaveFailed':
    '저장하지 못했습니다. API 모드에는 모델과 API 키가 필요합니다.',
  'modelSettings.openPlatform': 'OpenAI API 키 관리 페이지 열기',
  'modelSettings.platformHint': '앱 밖에서 공식 OpenAI API 플랫폼을 엽니다',
  'modelSettings.accessError': 'API 인증 또는 모델 접근 권한을 확인해 주세요.',
  'modelSettings.rateLimitError':
    '요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  'modelSettings.networkError': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  'modelSettings.accountChanged':
    '연결 계정이 변경되었습니다. 목록을 다시 불러와 주세요.',
  'modelSettings.checkingAccount': '연결 계정을 확인하고 있습니다.',
  'modelSettings.refreshAccountModels':
    '이 API 계정의 모델 목록을 새로고침해 주세요.',
  'modelSettings.registerApiKey':
    '연결된 계정에서 OpenAI API 키를 등록해 주세요.',
  'modelSettings.accountReadFailed':
    '계정을 읽지 못했습니다. 화면을 다시 열어 주세요.',
  'modelSettings.loadingModels': '이 API 계정의 모델을 불러오고 있습니다.',
  'modelSettings.modelListNotice':
    '현재 API 계정에서 조회한 목록입니다. 통화 권한과 잔액, 실제 세션 사용 가능 여부는 별도로 확인됩니다.',
  'modelSettings.noSupportedVoice':
    '이 계정에서 사용할 수 있는 GPT-Live-1.1을 찾지 못했어요.',
  'modelSettings.modelLoadFailed':
    '모델 목록을 불러오지 못했습니다. 다시 시도해 주세요.',
  'modelSettings.voiceChanged': '음성 모델이 변경되었습니다',
  'modelSettings.voiceRestart':
    '선택한 음성 모델로 다시 시작해 주세요. OpenAI Live를 기기 내 음성으로 대신 실행하지 않아요.',
  'modelSettings.appleVoice': 'Apple 시스템 음성',
  'modelSettings.appleVoiceDescription':
    '기기 내 음성 인식과 합성. 언어와 기기 지원이 필요하며 답변은 선택한 대화 AI가 만듭니다.',
  'modelSettings.realtimeDescription':
    'OpenAI Realtime API 음성 입출력. 네트워크와 별도 API 계정이 필요합니다.',
  'modelSettings.subscriptionNotice':
    '이 계정에서 조회한 대화 모델입니다. OpenAI API 연결과 별개이며 구독에 API 사용 요금이나 크레딧이 포함되지는 않습니다.',
  'modelSettings.localVoiceNotice':
    '기기 내 처리: 음성 인식과 읽어주기는 기기에서 실행합니다. 인식된 텍스트는 선택한 대화 AI에 기존 동의 절차로 전달될 수 있습니다.',
  'modelSettings.staleModels':
    '이 API 계정의 이전 조회 목록입니다. 최신 목록이 아니므로 새로고침 후 선택해 주세요.',
  'modelSettings.listPrivacy':
    '목록 조회는 음성이나 대화 내용을 보내지 않으며 통화를 시작하지 않습니다.',
  'modelSettings.apiPrivacy':
    'API 처리에는 음성과 대화 내용의 OpenAI 전송 및 API 사용 요금이 발생할 수 있습니다. ChatGPT 로그인과 API 키는 별개입니다. 이용 가능한 크레딧은 API 계정에서 확인하세요.',
  'modelSettings.apiBilling':
    'ChatGPT 구독과 별도이며, API 사용 요금이 발생할 수 있습니다.',
  'modelSettings.savingPrivacy':
    '저장만으로 API 요청이나 음성 전송은 시작되지 않습니다.',
  'modelSettings.platformOpenFailed':
    '페이지를 열지 못했습니다. 위 링크를 눌러 다시 시도해 주세요.',
  'modelSettings.selectedAiPrefix': '선택한 AI ·',
  'modelSettings.savedModelUnavailable':
    '저장된 모델 {model}의 현재 사용 가능 여부를 확인하지 못했습니다. 선택은 유지되며 다른 모델로 자동 전환하지 않습니다.',
} as const;
