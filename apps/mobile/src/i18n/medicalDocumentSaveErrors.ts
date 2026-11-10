/** Save recovery copy stays distinct from file selection and reading errors. */
export const medicalDocumentSaveErrorsKo = {
  'medicalDocument.error.saveFailed':
    '문서를 저장하지 못했어요. 내용을 유지했으니 다시 저장하거나 가져오기를 취소해 주세요.',
  'medicalDocument.error.staleDocument':
    '선택한 문서를 더 이상 저장할 수 없어요. 가져오기를 취소하고 문서를 다시 선택해 주세요.',
  'medicalDocument.error.duplicateRecoveryFailed':
    '기존 문서의 원문을 확인하지 못했어요. 다시 저장하거나 가져오기를 취소해 주세요.',
} as const;
