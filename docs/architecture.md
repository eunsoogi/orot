# 오롯의 구성과 데이터 흐름

[제품 소개로 돌아가기](../README.md)

오롯은 상담 기록과 건강 정보, 진료 일정을 아이폰에 모아 다음 진료를 준비하도록 돕는 개인 건강 기록 앱입니다. 아래 흐름도는 실제 앱의 기록 수집과 저장 경로, 검색과 AI 구성요소의 경계를 보여줍니다.

아래 설명은 현재 iOS 앱의 구현 경로를 다룹니다.

### 저장된 기록에서 기능 모듈까지

```mermaid
flowchart LR
  imports["HealthKit 선택 가져오기"]
  recording["상담 녹음, 요청형 전사"]
  audio[("보호된 오디오 파일<br/>앱 백업 제외")]
  source["@orot/domain<br/>출처 ID, 시점, 근거 위치"]
  calendar["EventKit 일정 후보"]
  appointment["사용자가 확인한<br/>AppointmentRepository 스냅샷"]
  local[("로컬 SQLCipher<br/>기록, 벡터, memory table")]
  chunks["호출자가 구성한<br/>EvidenceChunk 스냅샷"]
  rag["@orot/rag<br/>기기 안의 E5 + FTS5"]
  reviewed["사용자 확인 또는<br/>사람이 검토한 정보"]
  memory["Rememori<br/>LangGraph BaseStore<br/>별도 memory table<br/>LangChain 도구"]
  ragConversation["기록과 대화 서비스<br/>로컬 근거 검색"]
  hypotheses["증상 정리<br/>질환 가설 task"]
  home["한국어 홈<br/>네 기능 바로 가기"]
  runtime["@orot/agent-runtime<br/>LangChain 도구와 LangGraph"]
  selection["제공자 선택 화면<br/>Apple 또는 ChatGPT OAuth"]
  provider["LanguageModelProvider<br/>제공자 중립 계약"]
  transferConsent["원격 실행 전<br/>전송 내용과 수신자별 동의"]
  questions["다음 진료 질문<br/>로컬 근거와 예약 연결<br/>검토와 저장"]
  external["외부 근거 검색 화면"]
  queryConsent["검색어 종류별<br/>외부 조회 동의"]
  evidenceTool["Europe PMC 근거<br/>검색 어댑터"]
  evidenceService["호출자가 제공하는<br/>Europe PMC 검색 서비스"]
  evidenceMetadata["인용, 출처 버전, 날짜<br/>검색 범위, 누락, 잘림 정보"]
  literature["Europe PMC"]

  imports --> source --> local
  recording --> source
  recording --> audio
  calendar --> appointment --> local
  local -. "호출자가 검색 단위를 전달" .-> chunks --> rag
  reviewed -. "쓰기는 별도 정책 승인 필요" .-> memory
  rag --> questions
  rag --> hypotheses
  rag --> ragConversation
  questions --> runtime
  hypotheses --> runtime
  ragConversation --> runtime
  memory -. "검토된 기억" .-> questions
  home --> questions
  home --> hypotheses
  home --> ragConversation
  home --> external
  selection -. "저장된 제공자, 모델" .-> provider --> runtime
  runtime -. "원격 호출 직전" .-> transferConsent -. "승인된 요청" .-> provider
  external --> queryConsent --> evidenceService --> literature
  runtime -. "호출자가 도구로 제공할 때" .-> evidenceTool --> queryConsent --> evidenceService
  literature --> evidenceService --> evidenceTool --> evidenceMetadata -. "활성 실행으로 전달" .-> runtime
```

실선은 앱 코드의 연결 경로를, 점선은 근거 선택이나 사용자 승인이 필요한 경계를 나타냅니다. 녹음 파일은 SQLCipher 데이터베이스와 분리된 보호 파일입니다. 로컬 RAG는 다음 진료 질문, 증상 정리, 기록과 대화에서 사용하며 호출자가 준비한 출처 연결 검색 단위만 처리합니다. 모든 기록을 자동으로 색인하지 않습니다.

### 기록 수집과 기기 안의 저장

```mermaid
flowchart LR
  subgraph capture["iOS 앱에서 기록을 모읍니다"]
    consent["참여자 안내와 동의<br/>마이크 접근"]
    recording["상담 녹음"]
    audio[("보호된 오디오 파일<br/>앱 백업 제외")]
    transcribe{"사용자가 전사를 별도 요청"}
    speech["Apple Speech<br/>기기 안에서 처리"]
    health["HealthKit<br/>선택한 건강 관찰"]
    eventkit["EventKit<br/>일정 후보 조회"]
    selectEvent["사용자가 일정 선택, 확인"]
  end

  subgraph local["아이폰 안의 기록 저장"]
    source["@orot/domain<br/>출처, 시점, 근거 위치"]
    appointment["AppointmentRepository<br/>확인된 일정 스냅샷"]
    records["@orot/storage<br/>record repository"]
    db[("SQLCipher 데이터베이스")]
    key["iOS Keychain<br/>데이터베이스 암호화 키"]
  end

  consent --> recording --> audio
  recording --> source
  recording --> transcribe
  transcribe -->|"예"| speech --> source
  health --> source
  eventkit --> selectEvent --> appointment
  source --> records
  appointment --> records
  records --> db
  key -. "키로 사용" .-> db
```

녹음과 전사는 별도 동작입니다. 녹음은 참여자 안내와 동의, 마이크 접근을 확인한 뒤 시작하며, 전사는 사용자가 따로 요청해야 Apple Speech가 처리합니다. HealthKit 기록은 선택해 가져옵니다. EventKit 일정 후보는 앱 안에서 확인하고, 사용자가 선택해 확인한 일정만 암호화 저장소에 남깁니다. HealthKit 공통 관찰, 혈압 가져오기, EventKit 일정은 각각 별도 흐름입니다. 녹음 파일은 보호된 파일로 따로 보관하고 앱 백업에서 제외합니다. 전체 앱 데이터의 iCloud 백업과 복원은 지원 기능으로 설명하지 않습니다. 데이터베이스 키는 iOS Keychain에 저장합니다. 건강 기록을 보관하는 오롯 자체 서버는 없습니다.

### 로컬 근거 검색과 에이전트 메모리

```mermaid
flowchart LR
  subgraph rag["로컬 RAG 모듈"]
    chunks["호출자가 전달하는 EvidenceChunk<br/>출처 ID와 원문 위치"]
    document["기기 안의 E5<br/>문서 임베딩"]
    vectors[("SQLCipher<br/>문서 벡터")]
    query["검색 질문"]
    queryVector["기기 안의 E5<br/>질의 임베딩"]
    similarity["문서 벡터와<br/>코사인 유사도 순위"]
    fts["FTS5 임시 테이블<br/>BM25 키워드 순위"]
    fusion["의미, 키워드 순위 결합<br/>역순위 융합"]
    hits["검색 근거와 원문 위치"]
    deleteRag["출처 삭제 때<br/>연결 RAG 청크 정리"]
    chunks --> document --> vectors
    query --> queryVector --> similarity
    vectors --> similarity --> fusion
    chunks --> fts --> fusion
    fusion --> hits
    deleteRag --> vectors
  end

  subgraph memory["별도 Rememori 메모리"]
    approved["사용자가 확인했거나<br/>사람이 검토한 정보"]
    tools["LangChain 메모리 도구<br/>저장, 검색, 수정, 삭제"]
    engine["오픈소스 Rememori<br/>메모리 엔진"]
    memoryTable[("SQLCipher 안의 별도 메모리 테이블")]
    removeSource["녹음 라이브러리<br/>확인 후 삭제"]
    approved --> engine
    tools <--> engine
    engine <--> memoryTable
    removeSource --> memoryTable
    removeSource --> deleteRag
  end
```

로컬 RAG 모듈은 호출자가 건넨 출처 연결 검색 단위를 E5로 임베딩하고, 벡터 순위와 임시 FTS5 테이블의 BM25 순위를 합쳐 근거를 반환합니다. 벡터는 SQLCipher에 저장하고, FTS5 검색 본문은 메모리 안의 임시 테이블에서 사용한 뒤 지웁니다. E5 모델과 토크나이저는 처음 사용할 때 내려받고, 검색 질문과 기록 본문은 기기 안에서 임베딩하고 검색합니다. 다음 진료 질문, 증상 정리, 기록과 대화 서비스가 이 검색 모듈을 사용합니다.

증상과 기록 요약 및 기록과 대화에는 모델이 선택하는 `local-health-context` 도구도 제공합니다. 최근 7·30·90일 중 선택한 기간을 기기 시간대의 날짜로 나누고 SQL 안에서 집계하므로 전체 원시 기록을 JavaScript로 읽지 않습니다. 기본 응답은 기록 일수, 일별 평균의 평균, 측정 범위와 최근 구간 비교이며 주별·일별 상세는 별도로 요청합니다. 복약 등록·사용자 확인·처방·개별 복용 기록을 구분하고, 기기별 걸음 수를 합산하지 않으며, 수면은 겹치는 구간의 합집합을 사용합니다. 무효화된 전사 파생 기록은 집계에서 제외합니다. 원래 기간·시간대·집계 정책과 집계 결과의 지문을 인용에 연결하며, 저장 트랜잭션 안에서 다시 계산해 변경·삭제 경쟁을 검사합니다. 기간에 해당하는 기록을 삭제하거나 다른 기간으로 옮기면 연결된 저장 요약도 정리합니다. 집계 캐시는 고정 개수로 제한하고 데이터 변경 세대로 갱신합니다.

Rememori는 호출자가 제공한 근거 조각을 검색하는 로컬 RAG와 별도의 기억 구성요소입니다. 입력에는 출처와 `user_confirmed` 또는 `human_reviewed` 검토 상태가 필요합니다. LangChain memory 쓰기 도구를 사용할 때는 호출자가 제공한 승인 정책이 필요합니다. 모든 앱 기록을 자동으로 색인하거나 모델 응답을 자동 저장하지는 않습니다. #30 질문 추천 workflow는 로컬 RAG와 검토된 memory를 근거로 조회하고, 사용자가 확인해 저장한 질문만 출처 연결 memory로 남깁니다. 이 memory는 같은 SQLCipher 데이터베이스의 별도 테이블에 저장됩니다.

LangGraph의 `BaseStore` adapter인 `RememoriLangGraphStore`는 namespace와 key로 지정한 지속 memory 항목을 저장하며 graph `thread_id`에 종속되지 않습니다. `BaseCheckpointSaver`는 별도의 계약으로, thread별 graph 상태와 진행 정보 및 pending write를 저장합니다. 두 저장소는 데이터와 수명 범위가 다릅니다.

저장된 녹음은 녹음 화면의 라이브러리에서 확인 후 삭제할 수 있습니다. #147의 삭제 경로는 오디오 파일 정리와 SQLCipher의 출처 종속 레코드, 연결된 RAG 청크 및 Rememori memory 삭제를 연결합니다. 삭제된 출처 식별자는 tombstone으로 보존되어 이후 쓰기와 근거 재검증에서 오래된 참조를 거부하는 데 쓰입니다. 체크포인트 저장소에서는 해당 출처에 명시적으로 연결된 thread의 checkpoint와 pending write만 삭제하며, 관련 없는 thread는 유지합니다.

### 제공자 선택과 모델 실행 구성요소

```mermaid
flowchart LR
  subgraph selection["제공자 선택 화면 구성요소"]
    appleOption["Apple Intelligence 사용 가능 여부"]
    account["ChatGPT OAuth 로그인<br/>성공, 취소 후 앱 복귀"]
    signOut["앱 내 ChatGPT 계정 로그아웃"]
    accountState["네이티브 계정 상태 갱신<br/>자격 증명 별도 저장"]
    catalog["인증된 계정의 모델 목록"]
    choose["제공자와 모델 선택"]
    confirm["제공자 안내 확인<br/>요청별 데이터 전송 동의와 별도"]
    identifiers["providerId와 modelId 저장"]
    keychain["iOS Keychain"]
    appleOption --> choose
    account --> accountState --> catalog --> choose
    signOut --> accountState
    choose --> confirm --> identifiers --> keychain
  end

  subgraph execution["공용 단일 모델 요청 그래프"]
    providerGraph["LangGraph generate 노드"]
    contract["LanguageModelProvider 계약"]
    apple["Apple Foundation Models<br/>기기 안에서 처리"]
    openai["ChatGPT / OpenAI 제공자"]
    providerGraph --> contract
    contract --> apple
    contract --> openai
  end
```

선택 화면은 ChatGPT OAuth 로그인과 계정 모델 목록 조회를 제공합니다. 현재 `main`에는 로그인 성공, 취소 뒤 앱으로 돌아오는 흐름과 앱 안의 로그아웃, 계정 상태 갱신이 구현되어 있습니다(#123). 사용자가 고른 `providerId`와 `modelId`는 선택 저장소에 기록하고 OAuth 계정 자격 증명은 별도 네이티브 저장 경로에서 관리합니다. #123의 CI와 Simulator 검증은 합성 계정을 사용했으며 실제 ChatGPT 계정이나 iPhone에서 로그인, 로그아웃한 것은 확인하지 않았습니다(#99, #113). 홈에서 연 기능 흐름 안에서도 제공자 선택 화면을 열 수 있으며, 각 AI 실행 서비스는 저장된 제공자, 모델 선택을 조회해 사용합니다.

기기 안에서만 처리하는 제공자 호출에는 외부 전송이 필요하지 않습니다. 제공자 선택 화면의 안내 확인은 개인 기록을 원격 모델에 보내는 동의가 아닙니다. 외부 문헌 검색도 원격 모델 요청과 별도의 동의 경로입니다. 검색 화면은 사용자가 직접 입력한 검색어를 별도 확인 뒤 외부 검색 서비스로 보내며, 개인 기록을 자동으로 함께 보내지 않습니다. 공유 실행 기반의 Europe PMC 어댑터와 직접 검색 화면은 같은 검색어 전송 동의 범위를 사용합니다. 최초 동의 후에는 검색어가 달라져도 같은 목적과 정보 종류·수신자 범위 안에서 다시 묻지 않습니다. 실제 전송할 검색어는 최초 동의 화면에서 펼쳐볼 수 있습니다. Orot에는 건강 기록을 받아 전달하는 자체 서버가 없으며, 원격 모델 요청은 연결된 기능이 동의를 받은 경우에만 선택된 내용을 해당 제공자로 보냅니다.

### 공용 멀티 에이전트 실행 기반

```mermaid
flowchart TB
  input["호출자가 제공<br/>요청, 허용 범위, 초기 근거, 제공자, 도구"]
  validate["실행 설정과 예산 확인<br/>근거 출처, 시점 검증"]
  responder["TaskResponder<br/>응답 또는 추가 근거 요청"]
  decision{"추가 근거가 필요한가?"}
  validateResult["응답 형식, 인용을<br/>현재 근거와 대조"]
  researcher["EvidenceResearcher<br/>허용된 읽기 전용 도구 선택"]
  validateTool["도구와 입력이<br/>허용 범위 안인지 확인"]
  localTool["LangChain 읽기 전용 도구<br/>결정론적으로 로컬 조회"]
  queryConsent["검색어 종류별<br/>외부 조회 동의"]
  europePmcTool["Europe PMC 근거<br/>검색 어댑터"]
  europePmcService["호출자가 제공하는<br/>Europe PMC 검색 서비스"]
  europePmc["Europe PMC"]
  externalEvidence["인용, 출처 버전, 날짜<br/>검색 범위, 누락, 잘림 정보"]
  evidenceCheck["근거 범위, 누락, 최신성 확인"]
  revision["TaskResponder<br/>근거를 반영해 응답 수정"]
  result["검증된 결과, 추가 질문, 안전한 중단"]

  input --> validate --> responder --> decision
  decision -->|"아니오"| validateResult --> result
  decision -->|"예"| researcher --> validateTool --> localTool
  localTool --> evidenceCheck --> revision --> validateResult
  validateTool -. "외부 의료 근거 도구" .-> europePmcTool --> queryConsent --> europePmcService --> europePmc
  europePmc --> europePmcService --> europePmcTool --> externalEvidence --> evidenceCheck
  evidenceCheck -->|"누락, 모순, 오래된 근거"| result
```

공용 실행 기반은 답변 담당자와 근거 조사 담당자의 역할을 분리합니다. 조사 담당자는 허용된 읽기 전용 도구와 입력만 고릅니다. 로컬 기록은 기기 안의 결정론적 도구로 조회하고, Europe PMC 도구는 검색어 종류와 수신자에 대한 별도 전송 동의를 확인한 뒤 검색 서비스를 사용합니다. 이 어댑터는 지원하지 않는 기간 조건을 거부하고 최대 다섯 건을 다루며, 인용 식별자와 출처, 근거 버전, 날짜, 검색 범위의 누락, 잘림 정보를 응답 역할까지 전달합니다. 체크포인트에는 외부 검색어와 검색 결과 본문을 저장하지 않고 근거 참조만 둡니다. 실행 기반은 결과의 출처, 범위, 최신성을 확인하고, 인용이 근거와 일치하는지 검증합니다. 근거가 모자라거나 서로 모순되면 단정적인 결과 대신 추가 질문이나 안전한 중단으로 끝냅니다. 모델 호출과 도구 사용에는 상한이 있으며 자동 재시도나 제공자 대체는 하지 않습니다. 앱 홈에서 네 기능에 바로 진입할 수 있으며, 원격 AI 요청은 선택한 제공자와 모델, 전송할 내용과 수신자를 확인한 뒤 동의를 받습니다. 외부 문헌 검색에는 검색어 전송에 대한 별도 동의가 필요합니다.

원격 처리 모드에서는 각 모델 호출 직전에 `ExecutionConsentPort`가 제공자, 모델, 수신자, 허용 범위와 실제 전송 내용을 묶어 사용자 동의를 확인합니다. 기능이 선언한 목적·정보 종류·허용 범위와 수신자·계정·모델이 같으면 저장된 동의를 재사용합니다. 개별 기록 값이나 일정 묶음이 바뀌어도 다시 묻지 않으며, 선언한 범위가 바뀌면 다시 동의받습니다. 저장소에는 이 동의 범위의 SHA-256 해시만 남기고 실제 요청 내용은 저장하지 않습니다. 실제 요청은 동의 대기와 전송 사이의 변경 여부를 확인하기 위해 메모리에서만 비교합니다. 설정에서 동의를 지우면 실행 중인 동의 캐시도 무효화합니다. 이 포트를 연결하는 기능은 전송 내용을 펼쳐볼 수 있는 사용자 확인 화면을 제공해야 합니다. 로컬 처리 모드에는 원격 전송 동의가 적용되지 않습니다.

### 네 가지 사용자 기능의 현재 연결 상태

| 기능           | 현재 코드에서 확인되는 부분                                                                 | 앱에서 이어지는 상태                                                                                |
| -------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 다음 진료 질문 | #30 workflow와 #32 화면을 사용해 질문의 근거를 열고, 검토한 질문을 예약에 저장합니다.       | 홈에서 바로 진입하며 확인된 예약, 연결된 기록, 녹음 전사, 검토한 기억을 바탕으로 질문을 준비합니다. |
| 증상 정리      | 기록을 바탕으로 가능성을 살펴보고 이를 뒷받침하거나 반박하는 근거와 불확실성을 보여 줍니다. | 근거가 충분하지 않으면 단정하지 않으며 진단이나 약 변경을 제안하지 않습니다.                        |
| 기록과 대화    | 로컬 RAG 검색 결과의 인용에서 원문으로 이동하고, 근거가 없거나 부족한 상태를 구분합니다.    | 호출자가 구성한 출처 연결 근거 단위만 검색합니다.                                                   |
| 의학 자료 찾기 | Europe PMC 결과의 원문 링크, 제공처, 출판일, 갱신일, 조회 날짜와 검색 범위를 표시합니다.    | 입력한 검색어를 별도 동의 뒤 전송하며 앱 안의 개인 기록과 외부 문헌을 구분합니다.                   |

네 기능은 앱의 AI 도우미 화면에서 각 서비스로 연결됩니다. 다음 진료 질문은 RAG와 사용자가 확인한 기억을 참고해 질문을 만들고, 사용자가 검토한 질문을 일정에 저장합니다. 증상 정리는 기록에서 찾은 근거와 반대 근거를 함께 보여 주며 진단이나 치료 결정을 대신하지 않습니다. 기록과 대화는 질문에 맞는 근거를 찾고 출처 원문으로 연결합니다. 의학 자료 찾기는 사용자가 입력한 검색어만 별도 동의 뒤 Europe PMC에 전송합니다.

### 체크포인트와 합성 평가

```mermaid
flowchart LR
  run["체크포인트 저장기를 제공한 실행"]
  metadata["체크포인트에 저장<br/>식별자, 단계, 예산, 근거 참조"]
  saver["BaseCheckpointSaver<br/>호출자가 제공하는 저장기<br/>모바일 어댑터는 SQLCipher 사용"]
  resume["새 thread_id로 재개 요청"]
  revalidate["같은 실행인지 확인하고<br/>저장된 출처의 최신성 재검증"]
  safe{"미완료 호출이 없고<br/>안전한 단계인가?"}
  continueRun["허용된 단계에서 계속"]
  stop["재생하지 않고 중단<br/>필요하면 새 실행"]
  run --> metadata --> saver --> resume --> revalidate --> safe
  safe -->|"예"| continueRun
  safe -->|"아니오"| stop
```

체크포인트에는 실행 식별자와 단계, 예산, 근거 참조만 저장합니다. 사용자 문장, 건강 기록 본문, 외부 검색어와 검색 결과 본문, 도구 입력, 모델 응답과 최종 결과는 저장하지 않습니다. 이 thread별 진행 상태는 `BaseCheckpointSaver`에 속하며, 지속 memory 항목을 저장하는 별도 `BaseStore`와 구분됩니다. 새 실행 식별자를 사용해 재개하고 원본 근거가 여전히 같은지 확인합니다. 진행 중이던 외부 호출을 다시 보내지 않으며, 저장된 상태가 안전하지 않으면 중단합니다. 체크포인트 저장기는 호출자가 실행 기반에 전달할 때 사용합니다.

`@orot/eval`은 검색, 에이전트, 안전성 평가용 합성 기록과 기대 근거를 제공합니다. 합성 자료는 제품의 건강 기록과 분리되어 있으며 임상적으로 검증된 데이터가 아닙니다. [진료 질문 합성 평가](evaluation/visit-questions.md)는 #30 워크플로를 결정적 테스트 어댑터로 평가하며 기본은 오프라인입니다. 별도 개발 실행에서 `OROT_LANGSMITH_EVAL=1`과 `LANGSMITH_API_KEY`를 지정해 opt-in하면 허용 목록에 지정된 합성 입력, 기대 출력, 그래프 결과, 평가 점수만 LangSmith로 전송합니다. 앱 `TelemetrySink`, 실제 사용자 기록, 운영 trace, Orot backend는 사용하지 않으며, 이 결과는 실제 provider 성능이나 임상 유효성을 입증하지 않습니다.

### 더 알아보기

세부 내용은 [상담 녹음](recording.md), [기기 내 전사](transcription.md), [HealthKit](healthkit.md), [캘린더](calendar.md), [로컬 RAG](local-rag-embeddings.md), [에이전트 메모리](agent-memory.md), [제공자 계약](provider-contracts.md), [멀티 에이전트 실행](multi-agent.md), [체크포인트](langgraph-checkpoints.md), [합성 평가 자료](../packages/eval/README.md)에서 확인할 수 있습니다. 개발 환경은 [개발 안내](development.md), 검사 절차는 [코드 품질 안내](code-quality.md)를 참고하세요.
