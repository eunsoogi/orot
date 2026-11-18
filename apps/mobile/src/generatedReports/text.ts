/** Korean presentation copy for the saved-output browser, separate from stored content. */
export const generatedReportCopy = {
  title: '생성한 보고서와 진료 질문',
  evidenceCounts: (title: string, supporting: number, contrary: number) =>
    `${title}: 뒷받침 근거 ${supporting}개 · 반대 근거 ${contrary}개`,
  sourceNavigationUnavailable:
    '이 화면은 저장된 결과를 열람하는 화면이에요. 근거의 원문 링크는 제공하지 않아요.',
  open: '보고서·진료 질문 보기',
  description:
    '저장한 결과를 확인해요. 목록에서는 보고서 내용을 미리 표시하지 않아요.',
  possibilities: '질병 가능성 보고서',
  health_summary: '내 건강 정보 요약',
  daily_report: '오늘의 보고서',
  visit_questions: '진료 질문',
  loading: '저장한 결과를 확인하고 있어요.',
  empty: '저장된 보고서나 진료 질문이 없어요.',
  failed: '저장한 결과를 불러오지 못했어요.',
  retry: '다시 확인',
  more: '더 보기',
  back: '목록으로',
  close: '닫기',
  unavailable:
    '이전 버전이거나 출처의 변경·삭제로 현재 열람할 수 없는 저장 결과예요. 다른 버전으로 대신 열지 않아요.',
  changed:
    '생성 당시와 원본 자료가 달라졌어요. 저장된 결과의 주의사항을 확인해 주세요.',
  coverage:
    '생성 당시 저장된 결과예요. 현재 진단이나 새 분석이 아니며, 원본 출처 확인이 필요한 내용이 포함될 수 있어요.',
} as const;
