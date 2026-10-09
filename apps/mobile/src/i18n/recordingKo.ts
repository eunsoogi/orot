/** Korean copy for local recording, transcript review, and their error states. */
export const recordingKo = {
  'recording.title': '상담 녹음',
  'recording.back': '뒤로',
  'recording.consent.description':
    '녹음 전에 상담 참여자 모두에게 녹음 사실을 알리고 동의를 받아 주세요.',
  'recording.consent.acknowledgement':
    '참여자에게 녹음 사실을 알리고 동의를 받았습니다.',
  'recording.localOnly':
    '녹음 파일은 이 기기에 보관되고 Orot 서버로 전송되지 않습니다.',
  'recording.status.idle': '녹음하지 않음',
  'recording.status.recording': '녹음 중',
  'recording.status.paused': '일시 정지됨',
  'recording.status.interrupted': '오디오가 중단되어 녹음이 일시 정지됨',
  'recording.status.completed': '녹음 저장됨',
  'recording.duration': '녹음 시간: {duration}',
  'recording.id': '녹음 ID: {id}',
  'recording.start': '녹음 시작',
  'recording.pause': '일시 정지',
  'recording.resume': '녹음 재개',
  'recording.stop': '녹음 완료 및 저장',
  'recording.saved': '녹음을 이 기기에 저장했어요.',
  'recording.sourcePending':
    '녹음 파일은 이 기기에 보관 중이에요. 기록 연결을 다시 저장한 뒤 화면을 나갈 수 있어요.',
  'recording.retrySave': '기록 다시 저장',
  'recording.errors.consent':
    '녹음을 시작하기 전에 앱에서 동의를 확인해 주세요.',
  'recording.errors.microphonePermission':
    '마이크 권한이 필요해요. 설정에서 권한을 허용한 뒤 다시 시도해 주세요.',
  'recording.errors.sourceSave':
    '녹음 파일은 이 기기에 남아 있어요. 기록 연결을 다시 시도해 주세요.',
  'recording.errors.fileProtection':
    '녹음 파일 보호 또는 기기 백업 포함 여부를 확인하지 못해 기록 연결을 보류했어요. 파일은 이 기기에 남아 있습니다.',
  'recording.errors.generic':
    '녹음 상태를 처리하지 못했어요. 다시 시도해 주세요.',
  'recording.transcript.title': '전사 검토',
  'recording.transcript.localOnly':
    '전사는 Apple 기기 내 음성 인식으로 처리하고 서버로 보내지 않습니다.',
  'recording.transcript.description':
    '자동 전사는 검토 전 초안이에요. 오디오 구간을 듣고 필요한 내용을 수정해 주세요.',
  'recording.transcript.correctionNotice':
    '전사문은 검토 전 초안이에요. 오디오와 대조하고 필요한 내용을 수정해 주세요.',
  'recording.transcript.loading': '전사 기록을 불러오는 중…',
  'recording.transcript.noRecording': '전사할 수 있는 녹음이 없어요.',
  'recording.transcript.empty': '이 녹음에는 저장된 전사 내용이 없어요.',
  'recording.transcript.create': '이 녹음 전사하기',
  'recording.transcript.creating': '기기에서 전사 중…',
  'recording.transcript.error.load': '전사 기록을 불러오지 못했어요.',
  'recording.transcript.error.create':
    '녹음을 전사하지 못했어요. 기기 지원 상태를 확인해 주세요.',
  'recording.transcript.error.correct': '수정 내용을 저장하지 못했어요.',
  'recording.transcript.error.play': '오디오 구간을 재생하지 못했어요.',
  'recording.transcript.engine': '엔진: {engine}',
  'recording.transcript.runtime': '시스템 버전: {version}',
  'recording.transcript.range': '{start}–{end}',
  'recording.transcript.play': '이 구간 듣기',
  'recording.transcript.playing': '구간 재생 중…',
  'recording.transcript.review.unreviewed': '검토 전 초안',
  'recording.transcript.review.needsReview': '수정됨 · 다시 확인 필요',
  'recording.transcript.review.reviewed': '검토됨',
  'recording.transcript.origin.machine': '기계 전사',
  'recording.transcript.origin.userCorrection': '사용자 수정',
  'recording.transcript.verification.clinicianNotRecorded':
    '의료진 확인 기록 없음',
  'recording.transcript.edit': '수정',
  'recording.transcript.input.label': '전사 내용',
  'recording.transcript.save': '수정 저장',
  'recording.transcript.cancel': '취소',
  'recording.transcript.history': '이전 버전 {revision}: {text}',
  'recording.transcript.staleArtifacts':
    '수정으로 관련 파생 자료 {count}개가 다시 확인 대기 상태예요.',
  // Keep export labels with recording strings after the Korean catalog was split by feature.
  'recording.export.title': '녹음 내보내기',
  'recording.export.audio': '원본 음성 내보내기',
  'recording.export.transcript': '최신 전사 텍스트 내보내기',
  'recording.export.emptyTranscript': '아직 내보낼 전사 내용이 없어요.',
  'recording.export.error.load': '전사 정보를 불러오지 못했어요.',
  'recording.export.error.missingAudio': '녹음 원본 파일을 찾을 수 없어요.',
  'recording.export.error.emptyTranscript': '저장된 전사 내용이 없어요.',
  'recording.export.error.share':
    '파일을 내보내지 못했어요. 다시 시도해 주세요.',
  'recording.export.status.completed': '파일을 공유하거나 저장했어요.',
  'recording.export.status.cancelled': '내보내기를 취소했어요.',
  'recording.library.title': '저장된 녹음',
  'recording.library.loading': '녹음 목록을 불러오는 중…',
  'recording.library.loadError': '녹음 목록을 불러오지 못했어요.',
  'recording.library.empty': '저장된 녹음이 없어요.',
  'recording.library.details': '상세 보기',
  'recording.library.closeDetails': '상세 닫기',
  'recording.library.delete': '녹음 삭제',
  'recording.library.untitled': '이름 없는 녹음',
  'recording.library.confirmTitle': '녹음을 삭제할까요?',
  'recording.library.confirmMessage':
    '“{title}” 녹음과 전사 및 연결된 자료를 이 기기에서 삭제합니다.',
  'recording.library.cancel': '취소',
  'recording.library.deleting': '삭제 중…',
  'recording.library.confirmDelete': '삭제',
  'recording.library.deleteError':
    '녹음을 삭제하지 못했어요. 저장된 기록을 확인한 뒤 다시 시도해 주세요.',
  'recording.library.cleanupPending':
    '기록은 삭제됐고 오디오 파일 정리를 다시 시도할게요.',
  'recording.probe.synthetic': '시뮬레이터용 합성 녹음 준비',
  'recording.probe.failBeforeFile': '파일 준비 전 실패 시뮬레이션',
  'recording.probe.failAfterFile': '임시 파일 생성 후 실패 시뮬레이션',
  'recording.probe.interruptionBegan': '중단 시작 시뮬레이션',
  'recording.probe.interruptionEnded': '중단 종료 시뮬레이션',
} as const;
