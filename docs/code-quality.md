# 코드 품질 검사

저장소 루트에서 의존성과 고정 도구를 설치하고 전체 검사 범위를 확인합니다.

```sh
pnpm install --frozen-lockfile
pnpm quality:setup
pnpm quality:inventory
pnpm lint
pnpm format:check
```

`pnpm format:write`는 검사 대상 파일에 고정 포매터를 적용합니다. 적용 후 변경 diff를 확인하고 `pnpm lint`와 `pnpm format:check`를 다시 실행하세요. `quality:inventory`는 검사 대상 파일, 제외 파일, 제외 사유 및 대체 검증을 출력합니다.

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

Code Quality (code-quality.yml), Unit Test (unit-test.yml), Policy Check (policy-check.yml) workflow는 pull request의 opened, synchronize, reopened 이벤트와 main push, 수동 dispatch에서 실행됩니다. E2E Test (e2e-test.yml)는 schedule과 workflow_dispatch에서만 실행됩니다. main에서 complete Full selection이 확인될 때만 전체 Mac 검증 graph를 시작하며 pull request와 main push는 E2E를 시작하지 않습니다. 품질·단위·정책 workflow는 직접 job을 실행하고, E2E는 reusable iOS workflow를 호출합니다. 필수 check 이름은 release readiness 목록과 인증된 branch protection에서 확인합니다. Code Quality는 Maintained file inventory, 열 개의 Lint surface check, Source LOC policy, Format check를 각각 실행합니다. 각 lint leaf는 전체 inventory를 확인한 뒤 선택된 표면만 검사하며, 현재 파일이 없는 표면도 안정된 no-op check 이름을 유지합니다. Source LOC는 pull request에서 target base, main push에서 event before SHA와 비교하며 수동 dispatch에서는 전체 추적 파일을 검사합니다.

`Unit Test`는 `TypeScript typecheck`와 `Unit and component tests`를 실행하고, `Policy Check`는 CI·release·quality 정책 테스트를 실행합니다. 설치할 의존성과 포매터·린터는 기존 lockfile 및 도구 버전 해시로 검증합니다. 각 leaf는 실패 로그와 실행 결과를 별도 artifact로 보관합니다.

현재 전체 native 검증 graph의 workflow, reusable iOS build·execution workflow, cohort selector와 result validator가 실제 선택·실행·완료 규칙의 source of truth입니다. 각 cohort가 사용하는 제품, 실패와 미실행 기록, 최종 receipt 조건은 해당 구현을 따릅니다. 로컬 실행 절차는 [개발 안내](development.md), release acceptance는 [release 검증 안내](releasing.md)를 참고하세요.

전체 inventory와 cohort 배정은 [ios-test-inventory.mjs](../scripts/ci/ios-test-inventory.mjs), [ios-test-cohorts.mjs](../scripts/ci/ios-test-cohorts.mjs), [ios-test-execution-plan.mjs](../scripts/ci/ios-test-execution-plan.mjs)에 있습니다. 여러 profile의 합계를 더하면 같은 사례를 중복 계산할 수 있으므로 full plan에서 실제 선택되거나 실행된 사례의 수로 해석하지 마세요. 보호된 Keychain authentication은 별도 suite와 receipt에 남습니다. Release acceptance는 [release 검증 안내](releasing.md)가 정의합니다.

Release readiness의 정확한 check 이름은 `scripts/release/ci-required-jobs.mjs`의 `REQUIRED_CI_JOBS` 목록에 고정합니다. 기존 품질·typecheck·unit·policy 검사 16개에 `Validate /` 아래의 Build·UI·Storage·Provider·Speech·Questions 여섯 개를 합쳐 총 22개입니다. 이 목록은 저장소 보호 설정이 이미 변경됐다는 증거가 아닙니다. 이름을 변경할 때는 hosted CI의 실제 이름과 인증된 보호 설정을 대조하며 나머지 검사 및 GitHub Actions 연결을 보존해야 합니다.

## CI workflow 경계

Code Quality, Unit Test, Policy Check workflow는 workflow-level path filter 없이 직접 필수 check를 만들고, 내부 changed-path selector가 적용할 작업을 선택합니다. 정확한 경로 판정과 실패 시 선택 범위는 selector와 각 workflow 구현을 따릅니다. Markdown은 코드 formatting과 lint inventory에 포함되지 않지만, 문서 변경에도 CI·quality 정책을 확인하는 policy check는 실행됩니다.

E2E Test workflow는 schedule 또는 workflow_dispatch로 실행되며 pull request와 main push에서는 시작하지 않습니다. main에서 complete Full 선택이 확인될 때만 Mac 검증 graph를 시작합니다. E2E의 Validate 상태와 artifact는 해당 workflow에서 선택해 실행한 내용을 나타내며 필수 PR check나 별도 release gate를 대신하지 않습니다. 정확한 inventory, cohort 선택, 결과 판정은 위의 구현 링크와 [TEST.md](../TEST.md)를 따릅니다.
