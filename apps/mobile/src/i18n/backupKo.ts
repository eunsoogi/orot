export const backupKo = {
  // These strings describe local preparation only; iOS remains authoritative for cloud backup state.
  'backup.pageTitle': '백업과 복구',
  'backup.pageDescription': '기록 보관과 복구 상태를 확인해요.',
  'backup.localPreparation': '로컬 백업 준비',
  'backup.recoveryStatus': '복구 상태',
  'backup.recoveryNotChecked': '확인 전',
  'backup.icloudGuidance':
    'iCloud 백업 완료 여부는 iOS 설정에서 확인해 주세요.',
  'backup.openSettings': 'iOS 설정 안내',
  'backup.prepare': '백업 준비',
  'backup.title': 'iCloud 기기 백업 준비',
  'backup.description':
    '암호화된 오롯 기록과 상담 녹음이 기기 백업에 포함될 수 있도록 준비해요. 앱은 실제 백업 완료 여부를 확인할 수 없어요.',
  'backup.status.checking': '백업 준비 상태를 확인하고 있어요.',
  'backup.status.ready':
    '백업을 위한 데이터 준비를 마쳤어요. iOS 설정에서 iCloud 백업을 켜고 오롯 앱도 포함되어 있는지 확인해 주세요.',
  'backup.status.recoveryRequired':
    '기존 암호화 기록이나 복원 키를 확인할 수 없어 새 데이터베이스를 만들지 않았어요. 이전 기기 백업과 잠금 해제 상태를 확인해 주세요.',
  'backup.status.unavailable':
    '백업 준비 상태를 확인하지 못했어요. 기기를 잠금 해제한 뒤 다시 시도하고, iCloud 저장 공간은 설정에서 확인해 주세요.',
  'backup.settingsPath': '설정 > 사용자 이름 > iCloud > iCloud 백업',
} as const;
