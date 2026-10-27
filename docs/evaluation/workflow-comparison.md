# 진료 질문 워크플로 비교

같은 합성 기록과 모델로 전체 문맥, 단순 검색, 실제 앱 LangGraph 경로를 비교합니다. 기존 [진료 질문 평가](visit-questions.md)의 공급자 선택과 외부 전송 동의 규칙을 그대로 사용합니다. 실제 개인 건강 데이터는 입력할 수 없습니다.

## 실행

저장소 루트에서 개발 의존성을 설치한 뒤 실행합니다. 기본 실행은 네트워크를 사용하지 않는 결정적 프로토콜 검사입니다.

```sh
OROT_COMPARISON_OUTPUT=/tmp/orot-workflow-comparison.json \
  node scripts/evaluation/visit-questions/compare.cjs
```

실제 공급자 비교는 보안 환경에 `OPENAI_API_KEY`를 설정하고 같은 모델을 세 경로에 사용합니다. `OROT_COMPARISON_RAG_REVISION`에는 인증된 GitHub 조회로 확인한 #242의 실제 main 병합 커밋 전체 SHA를 넣습니다. 해당 커밋을 포함하는 깨끗한 통합 체크아웃에서 실행해야 합니다.

```sh
OROT_VISIT_QUESTION_PROVIDER=openai-api \
OROT_VISIT_QUESTION_MODEL="$EVALUATION_MODEL" \
OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING=1 \
OROT_COMPARISON_RAG_REVISION="$INTEGRATED_RAG_SHA" \
OROT_COMPARISON_OUTPUT=/tmp/orot-workflow-comparison.json \
  node scripts/evaluation/visit-questions/compare.cjs
```

보고서는 명시한 파일에 기록합니다. 저장소 외부 경로를 사용하면 결과 파일 때문에 작업 트리가 변경되지 않습니다. 경로 실행이 실패해도 다른 경로와 사례를 계속 기록하고, 부분 보고서를 쓴 뒤 명령을 실패 처리합니다. 기존 결과 파일은 덮어쓰므로 보존할 실행에는 새 파일명을 사용하세요.

`OROT_VISIT_QUESTION_SOURCE_ROOT`를 이용한 다른 체크아웃의 그래프 혼합은 거부합니다. 비교 실행은 LangSmith로 업로드하지 않으며 `OROT_LANGSMITH_EVAL=1`도 거부합니다. LangSmith 검증은 기존 그래프 평가의 별도 동의와 실행 결과로 확인해야 합니다. #36 종료는 실제 공급자 호출이나 LangSmith 업로드 증거가 아닙니다.

## 경로와 비교 조건

| 경로 | 동작 |
| --- | --- |
| `full-context` | 합성 저장소 전체의 현재 청크를 앱의 근거 매핑으로 재구성하고 검토된 메모리를 합쳐 한 번 생성합니다. 관련 없는 기록도 포함합니다. |
| `simple-rag` | 같은 합성 저장소에서 사례 질문으로 개인 기록과 검토된 메모리를 각각 한 번 검색합니다. 소스별 한도는 8이며 실제 검색 구현이 더 작은 한도를 적용할 수 있습니다. 결과를 합쳐 한 번 생성합니다. |
| `langgraph` | 실제 `runVisitQuestionWorkflow`를 실행합니다. 모델의 도구 선택, 추가 검색, 앱의 검증과 안전한 결과 변환을 포함합니다. |

모든 경로는 같은 fixture seed, 합성 임베딩, 공급자 모드와 모델을 사용합니다. 별도 sampling 설정은 추가하지 않습니다. 전체 문맥과 단순 검색은 앱의 질문 시스템 프롬프트와 결과 스키마를 사용하되 도구 반복이나 출력 수정을 수행하지 않습니다. 그래프의 검증 후 결과와 기준 경로의 생성 결과를 비교하므로 결과는 사용자에게 제공되는 경로 전체의 비교이며 원시 모델 정확도만의 비교는 아닙니다.

고정 순서로 사례와 경로별 한 번 실행합니다. 지연의 통계적 유의성이나 모델 간 우열을 주장하지 않습니다. 검색과 생성, 그래프 검증, 저장소 종료 시간을 측정하며 공통 fixture 및 전체 corpus 준비 시간은 제외합니다. 로컬 fixture 저장소와 결정적 임베딩은 실제 기기의 저장소 성능이나 임베딩 품질 증거가 아닙니다.

## JSON 결과 해석

형식은 `schemaVersion=orot.workflow-comparison.v1`입니다. `fixtureSha256`, `provider`, `evaluationTarget`, `evaluationHarness`, `toolchain`은 입력과 코드 및 의존성을 식별합니다. `integration`은 명시된 SHA가 현재 HEAD의 조상인지 검사합니다. 이 검사만으로 해당 SHA가 #242 병합이라는 사실을 증명하지는 않으므로 GitHub 병합 증거와 함께 읽어야 합니다. `finalComparisonEligible`은 실행 조건을 통과한 후보 표시이며 품질 승인이나 이슈 완료 판정이 아닙니다.

`cases`에는 세 합성 사례가 모두 남습니다. 각 사례의 `paths`에는 실행 상태, 제공된 근거 ID, 결과와 다음 `metrics`가 있습니다.

| 필드 | 의미 |
| --- | --- |
| `retrieval_recall` | 모델에 제공한 근거에서 정답 근거 ID를 회수한 비율입니다. 생성 결과의 인용 선택과 분리합니다. |
| `citation_support` | 기존 rubric의 출처·내용·revision 일치 및 필요한 근거 포함 비율입니다. 의미적 인용 지지의 사람 평가를 대신하지 않습니다. clarification에는 기존 rubric의 근거 가용성 검사를 적용합니다. |
| `temporal_error`, `numeric_error` | 기존 시간·수치 rubric 실패 여부를 0 또는 1로 기록합니다. 개별 오류 개수는 아닙니다. |
| `clarification_count` | 최종 응답이 clarification이면 1, 질문 결과이면 0입니다. 후속 대화 횟수는 측정하지 않습니다. |
| `useful_questions`, `clarification_behavior` | 기존 rubric의 질문 유용성과 확인 요청 적합성입니다. |
| `unsafe_medication_change` | 기존 rubric이 위험한 약 변경 권고를 감지하면 1입니다. |
| `latency_ms`, `token_usage` | 실제 경과 시간과 응답에서 받은 완전한 토큰 집계입니다. 토큰 누락은 `unmeasured`로 남깁니다. |

실행 실패 시 품질과 clarification 지표는 `null`이며 성공한 0점과 구별합니다. 토큰에 가격을 곱한 금액은 버전이 확인된 가격표를 공급하지 않아 `monetaryCost.status=unmeasured`입니다. 결정적 어댑터는 `protocol-fixture-only`이며 실제 모델 품질이나 토큰 비용의 증거가 아닙니다.

`regressions`는 전체 문맥 대비 단순 검색·그래프, 단순 검색 대비 그래프의 낮아진 지표와 실행 실패를 모두 보존합니다. `historical-measurement-without-current-reading` 사례에서 기존 그래프의 `useful_questions=0` 부족을 숨기거나 fixture 기대값을 낮추지 않습니다. 실제 공급자 결과는 측정 전까지 미측정이며 이 문서에는 생성하지 않은 결과가 없습니다.

## 회귀 검사

```sh
pnpm --filter @orot/eval test:unit
```

기본 검사에서도 실제 앱 그래프와 합성 검색을 실행하고, 세 경로 등록·검색과 인용 지표 분리·실패 및 미측정 처리·기존 부족 사례를 확인합니다. 이는 평가 실행기의 통합 검사이며 iOS 네이티브 E2E 증거가 아닙니다. 앱이나 네이티브 경계는 이 변경에서 수정하지 않습니다.
