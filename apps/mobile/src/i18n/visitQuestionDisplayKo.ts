/** Display-only restoration warnings and card actions; source lineage and clinical intent are unchanged. */
export const visitQuestionDisplayKo = {
  'visitRestore.changedAndUnknown':
    '건강 근거가 바뀌었고 이전 AI 결과의 일부 원본 상태도 확인할 수 없어요. 최신 자료를 확인해 질문을 다시 생성해 주세요.',
  'visitRestore.changed':
    '건강 기록이 바뀌어 일부 근거는 현재 자료로 확인할 수 없어요. 질문은 생성 당시의 내용으로 보관했으며, 바뀐 근거를 사용하려면 최신 기록으로 다시 생성해 주세요.',
  'visitRestore.unknownGeneratedOnly':
    '이전 AI 결과의 일부 원본 상태는 확인할 수 없어요. 직접 인용 위치가 저장되지 않은 질문은 다시 생성해 주세요.',
  'visitRestore.unknownGenerated':
    '이전 AI 결과를 연결했지만 일부 원본 출처의 현재 상태는 확인할 수 없어요. 내용을 다시 확인해 주세요.',
  'visitRestore.generatedOnly':
    '이전 AI 결과를 복원했어요. 직접 인용 위치가 저장되지 않은 질문은 다시 생성해 주세요.',
  'visitRestore.clarificationsOnly':
    '의료진에게 확인할 질문으로 저장했어요. 생성 당시의 추가 경고는 복원되지 않았습니다.',
  'visitRestore.missingSpan':
    '원문 근거 위치가 저장되지 않은 질문은 인용을 표시하지 않습니다. 원본 기록을 직접 확인해 주세요. 생성 당시의 추가 경고와 원본 버전도 보관되지 않았습니다.',
  'visitRestore.periodRestored':
    '기간별 건강 근거는 저장된 범위와 버전을 확인해 복원했어요. 생성 당시의 추가 경고는 보관되지 않았으니 근거를 다시 확인해 주세요.',
  'visitRestore.missingVersions':
    '저장된 질문에는 생성 당시의 추가 경고와 원본 버전이 보관되지 않아 복원하지 못했습니다. 표시된 원문 근거를 다시 확인해 주세요.',
  'visitRestore.webNotSaved':
    '{notice} 공개 웹검색 결과와 출처는 저장되지 않았어요.',
  'visitCard.up': '위로',
  'visitCard.down': '아래로',
  'visitCard.remove': '삭제',
  'visitCard.clarification': '의료진에게 확인할 질문',
  'visitCard.legacy': '원문 위치를 복원하지 못한 저장 질문',
  'visitCard.grounded': '기록에 근거한 질문',
  'visitCard.singleSource': '근거 1개 보기',
  'visitCard.editDetails': '질문 {number} 세부 수정',
  'visitCard.generatedSource': '생성에 사용한 이전 AI 결과 보기',
} as const;
