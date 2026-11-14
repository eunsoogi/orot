import { medicalDocumentDeletionKo } from './medicalDocumentDeletion';
/** Korean copy for selecting and viewing medical-document original photos. */
export const medicalDocumentOriginalPhotoKo = {
  ...medicalDocumentDeletionKo,
  'medicalDocument.review.originalPhoto': '선택한 원본 사진',
  'medicalDocument.review.photoReselect':
    '글자가 정확하지 않으면 가져오지 않고 다른 사진을 선택해 주세요.',
  'medicalDocument.source.original.openFullScreen':
    '원본 사진 전체 화면으로 보기',
  'medicalDocument.source.original.closeFullScreen': '전체 화면 닫기',
  'medicalDocument.source.original.title': '원본 사진',
  'medicalDocument.source.original.loading':
    '저장된 원본 사진을 불러오고 있어요.',
  'medicalDocument.source.original.missing':
    '저장된 원본 사진을 찾을 수 없어요. 추출된 글자는 원본 저장을 증명하지 않아요.',
  'medicalDocument.source.original.unavailable':
    '보호된 원본 사진을 지금 열 수 없어요. 기기 잠금이 풀린 뒤 다시 시도해 주세요.',
  'medicalDocument.source.original.unsupported':
    '이 원본 사진 형식은 표시할 수 없어요.',
  'medicalDocument.source.original.corrupt':
    '원본 사진이 저장된 정보와 달라 표시할 수 없어요. 추출된 글자는 원본 저장을 증명하지 않아요.',
  'medicalDocument.source.original.retry': '다시 불러오기',
  'medicalDocument.source.original.accessibilityLabel': '저장된 원본 사진',
  'medicalDocument.source.original.zoomIn': '원본 사진 확대',
  'medicalDocument.source.original.zoomOut': '원본 사진 축소',
  'medicalDocument.source.original.zoomReset': '원본 사진 확대 초기화',
};
