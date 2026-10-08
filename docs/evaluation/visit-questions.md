# 진료 질문 합성 평가

이 평가는 고정 seed의 합성 상담 기록, 혈압·수면 측정, 일정, 검토된 메모리를 사용해 #30의 실제 `runVisitQuestionWorkflow`를 실행합니다. 그래프가 평가 브랜치 밖에 있으면 별도의 detached checkout 경로를 지정할 수 있습니다. 실제 그래프 소스와 평가 harness의 Git revision은 결과에 따로 기록합니다.

그래프가 현재 checkout에 들어온 뒤에는 저장소 루트에서 오프라인 평가를 실행합니다.

```sh
node scripts/evaluation/visit-questions/run.cjs
```

그래프가 별도 PR checkout에 있으면, 해당 commit을 같은 저장소의 detached worktree로 준비하고 현재 workspace의 설치된 의존성을 연결합니다. #30 PR #125의 확인된 source head는 `7022e3221c940e2c8a288dd575d00b4f42bc8df6`입니다.

```sh
git worktree add --detach /tmp/orot-issue30-source-7022 7022e3221c940e2c8a288dd575d00b4f42bc8df6
ln -s "$PWD/node_modules" /tmp/orot-issue30-source-7022/node_modules
OROT_VISIT_QUESTION_SOURCE_ROOT=/tmp/orot-issue30-source-7022 env -u OROT_LANGSMITH_EVAL node scripts/evaluation/visit-questions/run.cjs
```

평가 checkout의 `node_modules`가 아직 준비되지 않았다면 먼저 저장소 개발 절차를 따르세요. 그래프 worktree의 `node_modules` 연결은 의존성 탐색에만 사용되며, 실제 그래프 source commit과 evaluator/toolchain revision은 각각 결과에 남습니다.

러너는 실제 그래프에 결정적 인메모리 테스트 어댑터를 연결합니다. 이 결과는 그래프 통합과 고정 rubric을 재현하지만 실제 모델의 품질이나 지연을 입증하지 않습니다. 보고서의 `latency_ms`는 로컬 그래프와 테스트 어댑터 실행 시간이며, `tokenUsage`는 그래프가 토큰 수를 공개하지 않아 `unmeasured`로 표시됩니다. `providerMode`는 항상 `test-adapter`입니다. `evaluationStatus: completed`와 종료 코드 0은 모든 합성 사례가 실행되어 결과를 기록했다는 뜻입니다. 개별 점수의 실패를 숨기거나 전체 점수가 모두 1이라고 가정하지 않으며, `failedDimensions`에 각 사례의 rubric 미달 항목을 남깁니다.

LangSmith에 보내려면 별도 개발용 환경에서 명시적으로 opt-in합니다.

```sh
OROT_LANGSMITH_EVAL=1 node scripts/evaluation/visit-questions/run.cjs
```

이 모드에는 `LANGSMITH_API_KEY`가 필요합니다. 키가 없으면 러너가 누락 사실만 표시하고 종료합니다. 러너는 환경 변수의 키를 입력·출력·피드백에 넣거나 출력하지 않습니다. LangSmith에는 `packages/eval`의 생성 fixture에서 만든 allowlist 입력, 기대 출력, 그래프 결과의 allowlist 출력, 평가 점수만 전송합니다. fixture 내용의 SHA-256으로 이름이 정해진 데이터셋을 생성하거나 재사용하며, 평가에는 데이터셋 ID를 전달해 SDK가 유효한 예제 ID와 생성 시각을 읽도록 합니다. 동일 fixture의 일부 업로드가 중단되면 누락된 예제만 채우고, 기존 내용이 달라졌다면 덮어쓰지 않고 실패합니다. 환경에서 상속된 `LANGSMITH_TRACING`과 `LANGCHAIN_TRACING_V2`는 그래프를 불러오기 전에 끕니다. 앱 `TelemetrySink`, 실제 사용자 기록, 운영 trace, Orot backend는 사용하지 않습니다.

점수는 출처 ID와 원본 기록 일치, 다음 진료 cue에 연결된 날짜, 수치와 단위의 연결 및 근거, 유용한 질문 또는 필요한 확인 요청, clarification 동작, 위험한 약 변경 권고를 다룹니다. 취소된 날짜는 이력에서 언급할 수 있지만, 다음 진료로 연결하면 안 됩니다. 적절한 clarification은 근거가 부족한 fixture에서 유용한 응답으로 평가합니다. 측정 가능한 실행 시간은 `latency_ms`로 기록하고, 토큰 수는 현재 워크플로가 내보내지 않으므로 출력 상태에 미측정 사유를 남깁니다.

각 로컬 보고서와 LangSmith 실험에는 평가 대상 workflow의 저장소 commit·경로·작업 트리 상태, 평가 harness commit·작업 트리 상태, toolchain의 `pnpm-lock.yaml` SHA-256·Node 버전을 별도 필드로 기록합니다. 따라서 그래프 변경과 evaluator 및 의존성 변경을 구분해 결과를 다시 확인할 수 있습니다.

별도의 실제 provider 실행은 이 러너에 포함되지 않습니다. 실제 provider를 통해 얻은 결과가 있을 경우 테스트 어댑터 결과와 분리해 provider 종류와 토큰·지연 측정 가능 여부를 함께 보고해야 합니다.

평가 코드 자체의 오프라인 단위 검사는 다음 명령으로 실행합니다.

```sh
pnpm --filter @orot/eval test:unit
```
