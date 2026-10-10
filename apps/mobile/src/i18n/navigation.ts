// Shared controls use one visible label and a clearer spoken name per navigation action.
export const navigationText = {
  back: {
    label: '뒤로',
    accessibilityLabel: '이전 화면으로 돌아가기',
  },
  cancel: {
    label: '취소',
    accessibilityLabel: '현재 작업 취소',
  },
  close: {
    label: '닫기',
    accessibilityLabel: '현재 화면 닫기',
  },
  home: {
    label: '홈',
    accessibilityLabel: '홈 화면으로 이동',
  },
  leaveUnsaved: {
    title: '저장하지 않은 내용이 있어요',
    message: '화면을 나가면 저장되지 않은 입력이 사라져요.',
    confirm: '내용 버리고 나가기',
    cancel: '계속 편집',
  },
  leaveRecording: {
    title: '녹음 중이에요',
    message: '녹음을 중단하고 화면을 나갈까요?',
    confirm: '녹음 중단하고 나가기',
    cancel: '계속 녹음',
  },
  leaveUnsavedAndRecording: {
    title: '저장하지 않은 내용과 녹음이 있어요',
    message: '화면을 나가면 입력 내용이 사라지고 녹음이 중단돼요.',
    confirm: '버리고 녹음 중단 후 나가기',
    cancel: '계속 머무르기',
  },
  leaveOngoingOperation: {
    title: '진행 중인 작업이 있어요',
    message: '화면을 나가면 현재 작업이 중단돼요.',
    confirm: '작업 중단 후 나가기',
    cancel: '계속 진행하기',
  },
  leaveUnsavedAndOperation: {
    title: '저장하지 않은 내용과 작업이 있어요',
    message:
      '화면을 나가면 저장되지 않은 입력이 사라지고 진행 중인 작업이 중단돼요.',
    confirm: '버리고 작업 중단 후 나가기',
    cancel: '계속 진행하기',
  },
  leaveRecordingAndOperation: {
    title: '녹음과 작업이 진행 중이에요',
    message: '화면을 나가면 녹음과 진행 중인 작업이 중단돼요.',
    confirm: '모두 중단하고 나가기',
    cancel: '계속 진행하기',
  },
  leaveUnsavedRecordingAndOperation: {
    title: '화면을 나가기 전에 확인해 주세요',
    message:
      '화면을 나가면 저장되지 않은 입력이 사라지고 녹음과 진행 중인 작업이 중단돼요.',
    confirm: '버리고 모두 중단 후 나가기',
    cancel: '계속 진행하기',
  },
  leaveAccountConnection: {
    title: '계정 연결 중이에요',
    message: '화면을 나가면 계정 연결이 중단돼요.',
    confirm: '연결 중단 후 나가기',
    cancel: '계정 연결 계속하기',
  },
  leaveUnsavedAndAccountConnection: {
    title: '저장되지 않은 선택과 계정 연결이 있어요',
    message:
      '화면을 나가면 저장되지 않은 선택이 사라지고 계정 연결이 중단돼요.',
    confirm: '선택을 버리고 계정 연결 중단 후 나가기',
    cancel: '계속 머무르기',
  },
  leaveRecordingAndAccountConnection: {
    title: '녹음과 계정 연결이 진행 중이에요',
    message: '화면을 나가면 녹음과 계정 연결이 중단돼요.',
    confirm: '모두 중단하고 나가기',
    cancel: '계속 머무르기',
  },
  leaveUnsavedRecordingAndAccountConnection: {
    title: '화면을 나가기 전에 확인해 주세요',
    message:
      '화면을 나가면 저장되지 않은 선택이 사라지고 녹음과 계정 연결이 중단돼요.',
    confirm: '선택을 버리고 모두 중단 후 나가기',
    cancel: '계속 머무르기',
  },
} as const;
