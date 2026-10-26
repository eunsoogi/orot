# 전사 기록 추출과 확인

앱의 `runLocalEncounterProcessing`은 녹음 source ID, 고유한 thread ID, 선택한 모델의 기존 execution·consent·Store 계약을 받습니다. `model.execution.allowedScope`는 해당 녹음 하나의 `personal_record` 범위여야 합니다. 모델을 선택하고 원격 전송 동의를 받는 호스트가 이 값을 구성합니다. 확인 화면의 최종 조합은 이 모듈의 범위 밖입니다.

그래프는 최신 전사 revision 로딩, 후보 추출, 기존 기록과의 충돌 확인, `user_confirmation` 앞의 LangGraph interrupt, 정규 도메인 저장 순서로 실행합니다. `pending` 결과의 전체 snapshot을 화면에 표시하고, 실제 사용자 확인 시 `EncounterApproval`에 그 snapshot과 선택한 후보, 사용자 ID와 확인 시각을 전달합니다. `deny`는 저장하지 않습니다. 후보를 제외하거나 텍스트·약물 설명을 수정할 수 있지만 ID, 종류, 화자, 근거는 바꿀 수 없습니다. 수정으로 새로운 충돌이 생기면 새 thread에서 다시 검토해야 합니다.

같은 thread를 승인 없이 호출하면 SQLCipher의 기존 LangGraph 체크포인트에서 대기 상태를 읽습니다. 추출을 다시 실행하지 않습니다. 승인 여부는 체크포인트에 저장하지 않으며 새 호스트 호출의 승인만 저장 권한으로 사용합니다. 중단된 추출의 모델 실행 횟수가 불명확하면 자동 재실행하지 않고 `unavailable`을 반환합니다. 같은 thread를 다른 녹음에 재사용할 수 없습니다.

사용자 확인은 전사 문장의 검토를 뜻합니다. 약물 언급은 `encounter_medication_statement`, 계획은 `encounter_plan` 개념의 정규 `HealthObservation`으로 저장합니다. 이를 현재 복용 확인이나 의사가 발행한 처방으로 바꾸지 않습니다. `derived` provenance와 `speaker:unknown`을 유지하며, 원문 전사에는 신뢰할 수 있는 화자 식별 정보가 없으므로 모델의 화자 추측을 채택하지 않습니다. 각 후보는 정확한 전사 revision, 반개방 UTF-16 텍스트 범위와 원문 인용, 대응하는 녹음 시간 범위의 `EvidenceSpan`을 참조합니다.

저장 트랜잭션에서 source 존재, 최신 전사 revision, 원문 범위, 현재 충돌과 승인 snapshot을 다시 검증합니다. 기록과 근거, 중복 방지 receipt는 기존 정규 repository와 같은 SQLCipher 트랜잭션에서 저장합니다. 저장 직후 체크포인트 기록이 중단되어도 같은 승인의 재전달은 기존 record ID를 반환하며 다른 승인으로 덮어쓰지 않습니다. 삭제된 기록을 재생성하지 않습니다. 이 receipt는 기존 sync checkpoint 저장 API를 사용하는 작업 영수증이며 별도 메모리 엔진이 아닙니다. 기존 checkpoint 저장소의 source 연결 옵션은 녹음 삭제와 같은 트랜잭션에서 그 녹음의 체크포인트·대기 쓰기·승인 영수증을 제거하고, 뒤늦게 도착한 checkpoint 쓰기를 거부합니다. 충돌 버전은 기존 네이티브 CryptoKit 해시를 사용하여 다른 source의 원문을 복사하지 않습니다.

추출은 기존 `runMultiAgentWorkflow`의 LangChain 모델·prompt·parser·동의·취소·호출 및 payload 예산을 사용합니다. 최대 8개의 최신 segment로 구성된 전사를 처리하며, 초과하거나 payload 예산을 넘으면 일부 내용을 조용히 버리지 않고 실패합니다. 체크포인트에는 검토용 후보와 인용이 포함되므로 앱에서는 반드시 기존 SQLCipher saver를 사용합니다. 복사된 callback manager와 하위 실행에서도 주변 configure hook·환경 추적 handler를 받지 않도록 격리합니다. 원격 telemetry나 일반 로그에 이 내용을 쓰지 않습니다.

검증은 [개발 안내](development.md)를 따릅니다. `StatePersistenceIntegrationTests`의 기존 세 테스트와 `state-persistence`/공유 persistence cohort에 실제 그래프의 대기 저장, 새 프로세스에서 수정 승인·중복 재개, 세 번째 프로세스에서 기록·근거 readback과 fixture 정리가 포함됩니다. 테스트 전용 모델 응답은 합성 자료이며 실제 모델 품질의 근거가 아닙니다. Jest의 파일 재개 테스트도 SQLCipher·Hermes·프로세스 재시작 검증을 대신하지 않습니다.
