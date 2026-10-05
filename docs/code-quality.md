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
| Objective-C, C, C++ | `clang-format --dry-run --Werror`; Objective-C 컴파일 검사는 필수 iOS Simulator Build에서 수행합니다. | Xcode 27.0의 clang-format 21.0.0 |
| Shell | ShellCheck 0.11.0 | shfmt 3.13.1, 들여쓰기 2칸 |
| Kotlin | ktlint 1.8.0 | ktlint 1.8.0 |
| Gradle, Groovy | npm-groovy-lint 18.0.0 | npm-groovy-lint 18.0.0 |
| Ruby, Podfile, Gemfile | RuboCop 1.91.0 `Lint` 규칙 | RuboCop 1.91.0 `Layout` 규칙 |
| GitHub Actions YAML | actionlint 1.7.12; YAML 파싱은 Prettier로 확인합니다. | Prettier 3.9.9 |
| JSON, XML, plist, Properties | Prettier 파서로 문법을 확인합니다. | Prettier 3.9.9와 XML·Properties 플러그인 |

SwiftFormat, ShellCheck, shfmt, ktlint, actionlint, Temurin JDK는 공식 릴리스 아카이브의 SHA-256을 `scripts/quality/tool-versions.json`에 고정합니다. Java는 17.0.20.1+1입니다. Prettier, ESLint, npm-groovy-lint와 플러그인은 `pnpm-lock.yaml`, RuboCop은 `scripts/quality/Gemfile.lock`으로 고정합니다. clang-format은 Xcode 27.0 도구체인을 확인합니다. 현재 재현 설치 대상은 CI와 같은 macOS ARM64입니다.

## 파일 선택과 제외

검사기는 Git이 추적하는 파일과 아직 추적하지 않는 일반 파일을 열거합니다. 지원되는 코드 확장자는 자동으로 검사 대상이 되고, 알 수 없는 파일 형식·설정은 실패합니다. TypeScript 파일은 기존 ESLint 설정이 있는 `apps/mobile/` 또는 `packages/` 아래에 있어야 합니다. 코드 심볼릭 링크는 체크아웃 바깥 경로를 포매터가 수정하지 못하도록 거부합니다.

품질 정책은 [`surface-policy.json`](../scripts/quality/surface-policy.json)에 있습니다. 잠금 파일, Gradle wrapper, Xcode 직렬화 메타데이터, 바이너리 자산과 기타 비코드 파일은 정확한 경로나 확장자로 분류하고 대체 검증을 함께 기록합니다. 추적된 `.env`는 경로로만 제외하며 검사기는 내용을 읽지 않습니다. ProGuard 파일의 현재 제외는 주석만 있을 때 유지되며 실행 규칙을 추가하면 검사가 실패합니다. Markdown 문서는 코드 품질 검사 범위가 아닙니다.

CI 명령 래퍼가 생성하는 `artifacts/quality/*.log`만 로그 산출물로 분류합니다. 같은 경로 아래의 다른 확장자는 파일 형식에 따라 검사되거나 미지원 파일로 실패합니다.

CI `Quality` 작업은 `pnpm quality:setup`, `pnpm quality:inventory`, `pnpm lint`, `pnpm format:check`를 실행합니다. 기존 타입 검사, 단위 테스트, 릴리즈 규칙, 250줄 검사와 별도 iOS·Detox 필수 작업은 계속 실행됩니다.
