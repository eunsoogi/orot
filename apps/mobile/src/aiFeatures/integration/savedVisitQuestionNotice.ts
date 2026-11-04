/** Describe which saved-question dependencies remain available after restoration. */
export function savedVisitQuestionNotice(input: {
  empty: boolean;
  hasChangedPeriod: boolean;
  hasUnknownGeneratedSource: boolean;
  hasGeneratedOnly: boolean;
  onlyClarifications: boolean;
  hasQuestionWithoutSourceSpan: boolean;
  hasPeriod: boolean;
}): string {
  return input.empty
    ? ''
    : input.hasChangedPeriod && input.hasUnknownGeneratedSource
      ? '건강 근거가 바뀌었고 이전 AI 결과의 일부 원본 상태도 확인할 수 없어요. 최신 자료를 확인해 질문을 다시 생성해 주세요.'
      : input.hasChangedPeriod
        ? '건강 기록이 바뀌어 일부 근거는 현재 자료로 확인할 수 없어요. 질문은 생성 당시의 내용으로 보관했으며, 바뀐 근거를 사용하려면 최신 기록으로 다시 생성해 주세요.'
        : input.hasUnknownGeneratedSource
          ? input.hasGeneratedOnly
            ? '이전 AI 결과의 일부 원본 상태는 확인할 수 없어요. 직접 인용 위치가 저장되지 않은 질문은 다시 생성해 주세요.'
            : '이전 AI 결과를 연결했지만 일부 원본 출처의 현재 상태는 확인할 수 없어요. 내용을 다시 확인해 주세요.'
          : input.hasGeneratedOnly
            ? '이전 AI 결과를 복원했어요. 직접 인용 위치가 저장되지 않은 질문은 다시 생성해 주세요.'
            : input.onlyClarifications
              ? '의료진에게 확인할 질문으로 저장했어요. 생성 당시의 추가 경고는 복원되지 않았습니다.'
              : input.hasQuestionWithoutSourceSpan
                ? '원문 근거 위치가 저장되지 않은 질문은 인용을 표시하지 않습니다. 원본 기록을 직접 확인해 주세요. 생성 당시의 추가 경고와 원본 버전도 보관되지 않았습니다.'
                : input.hasPeriod
                  ? '기간별 건강 근거는 저장된 범위와 버전을 확인해 복원했어요. 생성 당시의 추가 경고는 보관되지 않았으니 근거를 다시 확인해 주세요.'
                  : '저장된 질문에는 생성 당시의 추가 경고와 원본 버전이 보관되지 않아 복원하지 못했습니다. 표시된 원문 근거를 다시 확인해 주세요.';
}
