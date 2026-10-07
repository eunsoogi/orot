# 진료 질문 합성 평가

이 평가는 고정 seed의 합성 상담 기록, 혈압·수면 측정, 일정, 검토된 메모리를 사용해 #30의 실제 `runVisitQuestionWorkflow` 그래프를 실행합니다. 그래프 소스가 체크아웃에 없으면 러너가 실행 전에 종료 코드 2와 누락된 선행 조건을 알립니다.

저장소 루트에서 오프라인 평가를 실행합니다.

```sh
node scripts/evaluation/visit-questions/run.cjs
```

러너는 실제 그래프에 결정적 인메모리 테스트 어댑터를 연결합니다. 이 결과는 그래프 통합과 고정 rubric을 재현하지만 실제 모델의 품질이나 지연을 입증하지 않습니다. 보고서의 `latency_ms`는 로컬 그래프와 테스트 어댑터 실행 시간이며, `tokenUsage`는 그래프가 토큰 수를 공개하지 않아 `unmeasured`로 표시됩니다. `providerMode`는 항상 `test-adapter`입니다.

LangSmith에 보내려면 별도 개발용 환경에서 명시적으로 opt-in합니다.

```sh
OROT_LANGSMITH_EVAL=1 node scripts/evaluation/visit-questions/run.cjs
```

이 모드에는 `LANGSMITH_API_KEY`가 필요합니다. 키가 없으면 러너가 누락 사실만 표시하고 종료합니다. 러너는 환경 변수의 키를 입력·출력·피드백에 넣거나 출력하지 않습니다. LangSmith에는 `packages/eval`의 생성 fixture에서 만든 allowlist 입력, 그래프 결과의 allowlist 출력, 평가 점수만 전송합니다. 환경에서 상속된 `LANGSMITH_TRACING`과 `LANGCHAIN_TRACING_V2`는 그래프를 불러오기 전에 끕니다. 앱 `TelemetrySink`, 실제 사용자 기록, 운영 trace, Orot backend는 사용하지 않습니다.

점수는 출처 ID와 원본 기록 일치, 예약 날짜, 숫자 근거, 유용한 질문 또는 필요한 확인 요청, clarification 동작, 위험한 약 변경 권고를 다룹니다. 적절한 clarification은 근거가 부족한 fixture에서 유용한 응답으로 평가합니다. 측정 가능한 실행 시간은 `latency_ms`로 기록하고, 토큰 수는 현재 워크플로가 내보내지 않으므로 출력 상태에 미측정 사유를 남깁니다.

각 로컬 보고서와 LangSmith 실험에는 평가 대상 workflow의 저장소 commit·경로·작업 트리 상태와 toolchain의 `pnpm-lock.yaml` SHA-256·Node 버전을 별도 필드로 기록합니다. 따라서 그래프 변경과 의존성 변경을 구분해 결과를 다시 확인할 수 있습니다.

별도의 실제 provider 실행은 이 러너에 포함되지 않습니다. 실제 provider를 통해 얻은 결과가 있을 경우 테스트 어댑터 결과와 분리해 provider 종류와 토큰·지연 측정 가능 여부를 함께 보고해야 합니다.

평가 코드 자체의 오프라인 단위 검사는 다음 명령으로 실행합니다.

```sh
pnpm --filter @orot/eval test:unit
```
