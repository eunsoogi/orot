# 코드 품질 검사

저장소 루트에서 의존성과 고정 도구를 설치하고 전체 검사 범위를 확인합니다.

```sh
pnpm install --frozen-lockfile
pnpm quality:setup
pnpm quality:inventory
pnpm lint
pnpm format:check
```

`pnpm format:write`는 검사 대상 파일에 고정 포매터를 적용합니다. 적용한 뒤 `pnpm lint`와 `pnpm format:check`를 다시 실행하세요. `quality:inventory`는 검사 대상 파일, 제외 파일, 제외 사유 및 대체 검증을 출력합니다.

## 언어별 도구

| 파일                         | 린트 또는 정적 검사                                                                                                     | 포맷                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| JavaScript, TypeScript       | ESLint 8.57.1. 앱·패키지는 기존 React Native 규칙을 사용하고, 나머지 스크립트는 `eslint:recommended` 규칙을 사용합니다. | Prettier 3.9.9                           |
| Swift                        | SwiftFormat 0.62.1의 lint 모드                                                                                          | SwiftFormat 0.62.1                       |
| Objective-C, C, C++          | `clang-format --dry-run --Werror`; Objective-C 컴파일 검사는 필수 `Validate / Build`에서 수행합니다.                    | LLVM clang-format 21.1.8                 |
| Shell                        | ShellCheck 0.11.0                                                                                                       | shfmt 3.13.1, 들여쓰기 2칸               |
| Ruby, Podfile, Gemfile       | RuboCop 1.91.0 `Lint` 규칙                                                                                              | RuboCop 1.91.0 `Layout` 규칙             |
| GitHub Actions YAML          | actionlint 1.7.12; YAML 파싱은 Prettier로 확인합니다.                                                                   | Prettier 3.9.9                           |
| JSON, XML, plist, Properties | Prettier 파서로 문법을 확인합니다.                                                                                      | Prettier 3.9.9와 XML·Properties 플러그인 |

SwiftFormat, ShellCheck, shfmt, actionlint와 clang-format은 공식 릴리스 아카이브의 SHA-256을 `scripts/quality/tool-versions.json`에 고정합니다. Prettier, ESLint와 플러그인은 `pnpm-lock.yaml`, RuboCop은 `scripts/quality/Gemfile.lock`으로 고정합니다. 품질 도구 설치는 Linux x64와 macOS ARM64 자산을 지원하며, 각 아카이브는 설치 전에 고정 SHA-256과 버전을 검사합니다. LLVM clang-format 아카이브는 전체 SDK 대신 실행 파일과 Linux 실행에 필요한 공유 라이브러리만 추출합니다. Linux CI는 핀 버전과 아카이브 해시로 도구 캐시를 재사용합니다.

현재 고정된 actionlint는 GitHub Actions의 `concurrency.queue` 키를 아직 인식하지 못합니다. `scripts/quality/lint.mjs`는 해당 키를 사용하는 두 E2E workflow에서만 그 진단을 억제하고, 모든 workflow에 나머지 actionlint 검사를 계속 적용합니다.

## 플랫폼별 검사

`quality:inventory`는 모든 유지 관리 파일을 출력하고 각 언어 표면의 실행 플랫폼을 표시합니다. 모든 표면은 Linux에서 실행하며 Objective-C, C, C++ 표면도 LLVM clang-format 21.1.8로 Linux x64에서 검사합니다. 새 코드 표면은 정책에 실행 플랫폼을 지정해야 하며, 미지정 표면은 실패합니다. macOS에서 기본 명령을 실행하면 같은 전체 인벤토리를 macOS ARM64 도구 자산으로 확인합니다. iOS 컴파일과 Simulator 검증은 계속 Xcode 기반 필수 작업에서 실행합니다.

Linux CI와 같은 범위를 별도로 실행할 때는 다음과 같이 지정합니다. `all`이 기본값이며 Linux와 macOS 개발 환경에서 전체 인벤토리를 검사합니다.

```sh
pnpm quality:setup -- --platform linux
pnpm lint -- --platform linux
pnpm format:check -- --platform linux

pnpm quality:setup
pnpm lint
pnpm format:check
```

## 파일 선택과 제외

검사기는 Git이 추적하는 파일과 아직 추적하지 않는 일반 파일을 열거합니다. 지원되는 코드 확장자는 자동으로 검사 대상이 되고, 알 수 없는 파일 형식·설정은 실패합니다. TypeScript 파일은 기존 ESLint 설정이 있는 `apps/mobile/` 또는 `packages/` 아래에 있어야 합니다. 코드 심볼릭 링크는 체크아웃 바깥 경로를 포매터가 수정하지 못하도록 거부합니다.

품질 정책은 [`surface-policy.json`](../scripts/quality/surface-policy.json)에 있습니다. 잠금 파일, Xcode 직렬화 메타데이터, 바이너리 자산과 기타 비코드 파일은 정확한 경로나 확장자로 분류하고 대체 검증을 함께 기록합니다. 추적된 `.env`는 경로로만 제외하며 검사기는 내용을 읽지 않습니다. Markdown 문서는 코드 품질 검사 범위가 아닙니다.

CI 명령 래퍼가 생성하는 `artifacts/quality/*.log`만 로그 산출물로 분류합니다. 같은 경로 아래의 다른 확장자는 파일 형식에 따라 검사되거나 미지원 파일로 실패합니다.

`Code Quality`(`code-quality.yml`), `Unit Test`(`unit-test.yml`), `Policy Check`(`policy-check.yml`)는 pull request의 `opened`·`synchronize`·`reopened`, `main` push와 수동 실행에서 동작합니다. `E2E Test`(`e2e-test.yml`)는 pull request의 `opened`·`synchronize`·`reopened`·`ready_for_review`·`converted_to_draft`·`edited` 이벤트와 `main` push에서 Linux 영향 분석을 실행합니다. Ready PR과 main push는 영향받은 cohort만 실행하고, 문서만 바뀐 경우 Mac E2E 작업은 시작하지 않습니다. `main`의 수동 `workflow_dispatch`는 전체 릴리스 검증을 실행합니다. 품질·단위·정책 check는 직접 실행하고 E2E는 재사용 workflow를 호출합니다. 필수 검사 이름은 release readiness 목록과 저장소 보호 설정에서 함께 관리합니다. `Code Quality`는 `Maintained file inventory`, 열 개의 `Lint / <surface>` checks, `Source LOC policy`, `Format check`를 각각 실행합니다. 각 lint leaf는 전체 인벤토리를 검증한 뒤 한 표면의 파일만 lint하며, 현재 파일이 없는 설정 표면도 인벤토리 검증을 거쳐 독립된 no-op check 이름을 유지합니다. Source LOC leaf는 canonical 250줄 검사기를 pull request의 target base와 main push 직전 SHA로 실행하고, Code Quality 수동 실행에서는 전체 추적 파일을 검사합니다.

`Unit Test`는 `TypeScript typecheck`와 `Unit and component tests`를 실행하고, `Policy Check`는 CI·release·quality 정책 테스트를 실행합니다. 설치할 의존성과 포매터·린터는 기존 lockfile 및 도구 버전 해시로 검증합니다. 각 leaf는 실패 로그와 실행 결과를 별도 artifact로 보관합니다.

전체 release E2E dispatch는 Debug·Release·Production·OAuth 빌드 4개와 기능별 iOS 실행 cohort 29개, OAuth 실행 1개를 별도 Mac 작업으로 실행해 총 34개 작업을 구성합니다. Ready PR은 영향 분석으로 선택한 설정·cohort만 할당합니다. 독립 기능은 호환되는 산출물 producer만 기다리며 서로 기다리지 않습니다. 전체 graph의 이론상 최대 동시 Mac 31개는 실제 계정 한도가 아닙니다. 실제 대기·준비·부팅과 총 Mac 비용을 실행 자료로 확인합니다. producer 실패는 종속 작업 할당을 막고, 독립 작업의 실패는 이미 시작한 형제 작업의 진단을 취소하지 않습니다. `Validate / Build`는 Linux에서 기본 앱·실제 Apple SDK·기본 Keychain·OAuth package 실행·OAuth harness 빌드 의무를 확인합니다. Ready PR 집계는 선택된 빌드·cohort와 OAuth 실행의 성공 및 선택되지 않은 작업의 명시적 skip을 확인하고, 전체 release 집계는 전체 작업의 성공을 요구합니다.

전체 29개 기능 cohort의 release 계획은 200개의 고유 XCTest 사례를 각각 한 번씩 배정합니다. 넓은 프로필 inventory를 합산하면 Debug 33개, Release 161개, Speech 9개로 203개의 관측과 200개의 고유 사례가 됩니다. 세 문서 가져오기 UI 여정은 Debug `health-import`와 Release `fixtures` 양쪽 inventory에 포함되며 전체 계획에서는 한 번씩만 실행합니다. Face ID 등록이 필요한 보호 Keychain 조회 회귀 검사는 수동 `authentication` suite에 남겨 release 관측과 분리합니다. 네이티브 저장·복원처럼 실제 상태를 주고받는 단계만 같은 driver에서 순서를 유지합니다. 범위를 제한한 초기화는 실제 오염 주입·제거·외부 자료 보존 검증을 요구하고, fresh-install·키 수명주기·Backup 복원과 native permission 경계는 원래 초기화를 유지합니다. 수락에는 최종 후보의 전체 release 검증 한 번이 통과해야 하며 추가 반복 실행은 하지 않습니다. 정확히 선택한 통합·UI 사례는 별도 focused workflow에서 실행하며 전체 검증 끝에 추가하지 않습니다. identifier 검증, 첫 실패 보존, artifact 업로드와 소유 Simulator 정리는 유지합니다. 실행 절차는 [development.md](development.md)를 따릅니다.

Release readiness의 정확한 check 이름은 `scripts/release/ci-required-jobs.mjs`의 `REQUIRED_CI_JOBS` 목록에 고정합니다. 기존 품질·typecheck·unit·policy 검사 16개에 `Validate /` 아래의 Build·UI·Storage·Provider·Speech·Questions 여섯 개를 합쳐 총 22개입니다. 이 목록은 저장소 보호 설정이 이미 변경됐다는 증거가 아닙니다. 이름을 변경할 때는 hosted CI의 실제 이름과 인증된 보호 설정을 대조하며 나머지 검사 및 GitHub Actions 연결을 보존해야 합니다.

## 변경 경로별 CI 실행

네 개의 상위 workflow는 workflow-level `paths` 필터를 사용하지 않습니다. 각 workflow 안의 필수 check가 이벤트의 변경 경로를 선택해 관련 leaf만 실행하므로, 경로 필터 때문에 필수 check가 대기 상태로 남지 않습니다. pull request는 base와 head의 merge base부터 head까지, `main` push는 이벤트의 `before`와 `after` commit 사이를 비교합니다. 이름 변경은 이전 경로와 새 경로를 모두 검사하고, 삭제는 삭제된 경로의 정책을 적용합니다.

| 변경 경로                                                                  | 선택하는 검사                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown과 `AGENTS.md`                                                     | CI 정책 회귀 검사. Markdown은 품질 포매터 대상이 아니며 앱 빌드와 E2E는 실행하지 않습니다.                                                                                                                                                                                                                |
| 저장소의 앱 밖 래스터 이미지                                               | 코드 검사가 필요하지 않아 필수 leaf를 실행하지 않습니다. 앱 번들 이미지와 E2E fixture 이미지는 영향을 받는 iOS cohort를 선택하며, 앱 번들 이미지는 iOS 빌드도 선택합니다.                                                                                                                                 |
| 앱 소스와 공유 `packages/*`                                                | 관련 언어 lint, inventory, LOC, format, typecheck, unit tests, iOS 빌드 및 영향 분석으로 선택한 iOS cohort. Shared 또는 불확실한 의존 경계는 전체 cohort를 선택합니다.                                                                                                                                    |
| `apps/mobile/e2e/` 파일                                                    | 해당 파일의 언어 lint, LOC, format, CI 정책 회귀 검사와 영향 분석으로 선택한 cohort. Jest와 Metro가 이 지원 코드를 함께 사용하므로 새로 추가되거나 간접적으로 참조되는 파일까지 `Unit Test`를 선택합니다. 공유 helper와 실행 driver는 전체 cohort로 확장합니다. TypeScript 입력은 타입 검사도 선택합니다. |
| 잠금 파일, workspace 또는 native 의존성                                    | 모든 필수 검사.                                                                                                                                                                                                                                                                                           |
| `.github/actions/`, `scripts/ci/`, 알 수 없는 GitHub 설정 또는 미지원 경로 | 모든 필수 검사.                                                                                                                                                                                                                                                                                           |
| CI workflow 파일                                                           | 변경된 workflow와 그 종속 check를 선택하며 정책 회귀 검사도 실행합니다. workflow 변경을 인식할 수 없으면 모든 검사를 선택합니다.                                                                                                                                                                          |

변경 경로 비교가 불완전하거나 알 수 없는 이벤트·파일을 만나면 모든 검사로 대체합니다. 경로 selector를 사용하는 수동 `workflow_dispatch`도 전체 검사를 반환합니다. iOS 수동 선택은 별도 `E2E Test - Selected` workflow에서 정확한 사례만 실행하며 전체 필수 검사나 릴리스의 통과 근거로 인정하지 않습니다. 선택 실행은 전체 `Validate /` 검사 여섯 개를 생성하지 않으므로 같은 SHA의 전체 검사 결과와 충돌하지 않습니다. Selector의 출력 기록을 할 수 없으면 selector를 소유한 필수 check가 실패합니다. E2E 경로 선택이 실패하면 iOS build와 각 필수 E2E leaf가 실패 상태를 남기며 선택되지 않은 check로 위장하지 않습니다.

영향 분석이 iOS cohort를 선택하지 않으면 실제 빌드·실행 graph는 `skipped`로 표시됩니다. 필수 check 이름은 별도의 짧은 Linux 상태 job이 항상 기록하며, 변경 영향 범위에 없는 cohort는 성공 요약에 제외 항목으로 남깁니다. 따라서 상태 check의 성공만으로 E2E를 실행했다고 해석하지 말고, 선택 artifact, 실행 job 상태, 테스트 로그와 결과 artifact를 확인하세요. Ready PR은 현재 head의 영향 분석 결과만 실행하고, draft와 제목·본문 수정은 Mac runner를 시작하지 않습니다. `main` push도 `before`와 `after` 사이에서 영향받은 cohort만 실행하며, 불완전하거나 알 수 없는 영향은 전체 cohort로 대체합니다. 선택된 main-push 실행은 전체 릴리스 검증이 아니며, 전체 inventory는 `main`에서 `workflow_dispatch`로 확인합니다. Debug·Release·Production·OAuth 빌드와 선택된 feature test는 독립 VM을 사용합니다. 선택된 빌드·OAuth 검증·cohort만 관련 보호 상태를 통과시키며, 실패·취소·미실행된 필수 작업은 성공으로 집계하지 않습니다. 집중 진단은 전체 보호 상태나 release 근거로 사용할 수 없습니다.

iOS 검증의 전체 실행 목록은 `scripts/ci/ios-test-inventory.mjs`가 정의합니다. `ios-test-results.mjs`는 선택된 정확한 identifier와 실제 `.xcresult`의 결과를 대조하며, 누락·중복·미실행·실패를 성공으로 처리하지 않습니다. 집중 실행은 선택한 사례만 증명합니다. 새 소스나 공유 fixture·helper가 바뀌면 영향을 받는 검증을 다시 실행하고, 변경하지 않은 검증의 과거 실행 기록과 현재 적용 가능성은 구분해서 기록합니다. 최종 검증은 현재 head의 전체 실행·제품 무결성·필수 상태를 실제 Actions 결과로 확인해야 합니다.
