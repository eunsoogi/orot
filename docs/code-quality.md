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

| 파일 | 린트 또는 정적 검사 | 포맷 |
| --- | --- | --- |
| JavaScript, TypeScript | ESLint 8.57.1. 앱·패키지는 기존 React Native 규칙을 사용하고, 나머지 스크립트는 `eslint:recommended` 규칙을 사용합니다. | Prettier 3.9.9 |
| Swift | SwiftFormat 0.62.1의 lint 모드 | SwiftFormat 0.62.1 |
| Objective-C, C, C++ | `clang-format --dry-run --Werror`; Objective-C 컴파일 검사는 필수 iOS Simulator Build에서 수행합니다. | LLVM clang-format 21.1.8 |
| Shell | ShellCheck 0.11.0 | shfmt 3.13.1, 들여쓰기 2칸 |
| Ruby, Podfile, Gemfile | RuboCop 1.91.0 `Lint` 규칙 | RuboCop 1.91.0 `Layout` 규칙 |
| GitHub Actions YAML | actionlint 1.7.12; YAML 파싱은 Prettier로 확인합니다. | Prettier 3.9.9 |
| JSON, XML, plist, Properties | Prettier 파서로 문법을 확인합니다. | Prettier 3.9.9와 XML·Properties 플러그인 |

SwiftFormat, ShellCheck, shfmt, actionlint와 clang-format은 공식 릴리스 아카이브의 SHA-256을 `scripts/quality/tool-versions.json`에 고정합니다. Prettier, ESLint와 플러그인은 `pnpm-lock.yaml`, RuboCop은 `scripts/quality/Gemfile.lock`으로 고정합니다. 품질 도구 설치는 Linux x64와 macOS ARM64 자산을 지원하며, 각 아카이브는 설치 전에 고정 SHA-256과 버전을 검사합니다. LLVM clang-format 아카이브는 전체 SDK 대신 실행 파일과 Linux 실행에 필요한 공유 라이브러리만 추출합니다. Linux CI는 핀 버전과 아카이브 해시로 도구 캐시를 재사용합니다.

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

`Code Quality`(`code-quality.yml`), `Unit Test`(`unit-test.yml`), `Policy Check`(`policy-check.yml`), `E2E Test`(`e2e-test.yml`)는 `main` 대상 pull request, `main` push, 수동 실행 조건을 사용하는 독립 workflow입니다. 호출 workflow가 없으므로 GitHub check context에는 caller 이름이 붙지 않습니다. `Code Quality`는 `Maintained file inventory`, 열 개의 `Lint / <surface>` checks, `Source LOC policy`, `Format check`를 각각 실행합니다. 각 lint leaf는 전체 인벤토리를 검증한 뒤 한 표면의 파일만 lint하며, 현재 파일이 없는 설정 표면도 인벤토리 검증을 거쳐 독립된 no-op check 이름을 유지합니다. Source LOC leaf는 canonical 250줄 검사기를 pull request의 target base와 main push 직전 SHA로 실행하고, Code Quality 수동 실행에서는 전체 추적 파일을 검사합니다.

`Unit Test`는 `TypeScript typecheck`와 `Unit and component tests`를 실행하고, `Policy Check`는 CI·release·quality 정책 테스트를 실행합니다. 설치할 의존성과 포매터·린터는 기존 lockfile 및 도구 버전 해시로 검증합니다. 각 leaf는 실패 로그와 실행 결과를 별도 artifact로 보관합니다. Xcode와 Simulator가 필요한 `iOS Simulator Build` 및 Release UI/storage, Release stateful-data, OpenAI, Speech, Next Visit E2E leaf만 macOS runner를 사용합니다. E2E leaf는 자신의 전체 시나리오 결과를 확인하고 진단 artifact 업로드와 Simulator 정리를 수행합니다.

Branch protection과 release readiness가 사용하는 실제 check 이름은 `scripts/release/ci-required-jobs.mjs`의 `REQUIRED_CI_JOBS` 목록에 고정되어 있습니다. 주요 경로는 `Maintained file inventory`, `Lint / JavaScript|TypeScript|Swift|Objective-C|Shell|Ruby|YAML|JSON|XML|Properties`, `Source LOC policy`, `Format check`, 세 개의 typecheck/test leaf, `iOS Simulator Build`, 두 Release shard leaf, 그리고 OpenAI·Speech·Next Visit의 각 E2E leaf입니다. 이 목록의 새 check가 hosted CI에서 관측된 뒤 부모가 branch protection을 마이그레이션합니다.
