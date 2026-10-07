# 저장소 작업 지침

이 파일은 저장소 전체와 모든 하위 디렉터리에 적용됩니다. 시스템·개발자·직접 사용자 지시는 이 지침보다 우선하고, 더 깊은 경로의 `AGENTS.md`는 해당 하위 경로에서 부모 지침을 덮어씁니다. 안정적인 하위 전용 규칙이 없으면 별도 `AGENTS.md`를 만들지 마세요(`MUST NOT`).

## 구조와 기준 문서

- iOS 앱은 `apps/mobile/`에 있고, 공유 workspace 패키지는 `packages/*/`에 있습니다.
- 제품 개요와 사용자 기능은 [`README.md`](README.md), 개발 환경과 검사 절차는 [`docs/development.md`](docs/development.md)를 기준으로 삼아야 합니다(`MUST`).
- 품질 검사 범위와 도구 설명은 [`docs/code-quality.md`](docs/code-quality.md), 릴리즈 검증은 [`docs/releasing.md`](docs/releasing.md)를 따라야 합니다(`MUST`). 세부 절차를 이 파일에 복사하지 마세요(`MUST NOT`).
- iOS 화면, 공유 UI 구성요소 또는 앱의 공통 액션 영역을 새로 만들거나 수정·검토하기 전에는 [`DESIGN.md`](DESIGN.md)를 읽고 적용해야 합니다(`MUST`). 디자인 기준을 바꾸는 경우 `DESIGN.md`도 갱신해야 합니다(`MUST`).

## 변경과 검증

- 작업을 시작하기 전에 현재 변경 상태와 요청된 범위를 확인해야 합니다(`MUST`). 담당 범위 안에서 필요한 파일만 수정하고 다른 작업자의 변경을 보존해야 합니다(`MUST`). 무관한 변경을 포함하지 마세요(`MUST NOT`).
- 동작을 바꾸면 해당 동작을 입증하는 테스트를 추가하거나 갱신하고, 변경에 맞는 검사를 실행해야 합니다(`MUST`). 개발 의존성 설치와 기본 검사는 저장소 루트에서 다음 명령을 사용해야 합니다(`MUST`).

  ```sh
  pnpm install --frozen-lockfile
  pnpm quality:setup
  pnpm quality:inventory
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test:unit
  ```

- `pnpm format:write`는 검사 대상 파일을 수정합니다. 실행한 경우 결과 diff를 확인하고 `pnpm lint`와 `pnpm format:check`를 다시 실행해야 합니다(`MUST`).
- iOS Simulator 빌드와 Detox 검증이 필요한 변경은 `docs/development.md`의 준비 조건과 명령을 따라야 합니다(`MUST`). 변경 파일의 줄 수 검사는 같은 문서의 Source line policy를 사용해야 합니다(`MUST`).
- 검사 범위를 임의로 줄이거나 실패를 건너뛰지 마세요(`MUST NOT`). 제외가 필요한 경우에는 승인된 경로 제한을 사용하고 생략된 파일을 명시해야 합니다(`MUST`).

## 코드 주석

- 코드를 새로 작성하거나 수정하는 작성자는 관련된 유용한 주석을 추가하거나 갱신해야 합니다(`MUST`). 주석은 함수·모듈의 역할과 구현 의도를 설명하고, 해당되는 경우 비자명한 알고리즘, 도메인 제약, 시간대·기간·단위, 권한·동의·개인정보 경계, 실패 및 복구 처리, 외부 시스템의 가정이나 제약을 밝혀야 합니다(`MUST`).
- 주석은 코드만으로 분명하지 않은 이유, 불변 조건, 경계를 설명하세요. 코드를 그대로 되풀이하거나 변경된 동작과 맞지 않는 주석을 남기지 마세요(`MUST NOT`).
- 리뷰어는 변경된 코드와 관련 주석이 서로 일치하는지 확인해야 합니다(`MUST`). 근거 없는 보장, 비밀정보, 인증정보, 개인 건강정보를 주석에 넣지 마세요(`MUST NOT`).
