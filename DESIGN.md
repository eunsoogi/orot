# Orot 디자인 시스템

이 문서는 새 화면을 만들거나 기존 화면을 손볼 때 따를 시각, 상호작용, 접근성 규칙과 현재 구현 경로를 설명합니다. 제품 개요는 [README.md](README.md), 개발 절차는 [docs/development.md](docs/development.md), 날짜별 화면 검증 근거는 [design-qa.md](design-qa.md)를 참고하세요.

## 기준과 범위

Orot은 토스 화면에서 참고한 간결한 위계와 여백을 제품 방향으로 삼습니다. 토스의 이름, 아이콘, 기능, 색상을 그대로 가져오지 않습니다. 화면은 Orot의 실제 기록, 예약, 권한, 오류 상태를 보여 주며 예시 건강 정보나 상태를 실제 데이터처럼 만들지 않습니다.

현재 색상 값과 공통 API의 구현 기준은 저장소 소스입니다. 2026-10-12 기준 `main`은 `35c80a9b1a3bbe5f7a4a2c348ed3b69dd280969d`이며, 2026-10-11에 PR #186이 병합되었습니다. 내비게이션 내용은 병합된 소스와 PR #186의 최종 시뮬레이터 캡처를 기준으로 설명합니다. 시뮬레이터 캡처는 해당 실행에서 보인 화면과 검사 범위만 증명하며, 실기기나 VoiceOver 동작을 대신하지 않습니다.

이 문서는 화면 전반의 규칙을 기록합니다. 별도의 화면 디자인 시안은 구현 결과가 아니며, 이전 PR #141은 병합되지 않았으므로 그 색상이나 컴포넌트 API를 현재 기준으로 사용하지 않습니다. 현재 앱 전반의 디자인 구현은 이슈 [#103](https://github.com/eunsoogi/orot/issues/103), 하단 탭의 비율과 선택 표시는 이슈 [#181](https://github.com/eunsoogi/orot/issues/181)와 [PR #186](https://github.com/eunsoogi/orot/pull/186)을 참고하세요.

## 시각 원칙

- 화면마다 한 가지 주요 행동을 분명히 하고, 나머지 행동은 보조 버튼이나 조용한 목록 행으로 표현합니다.
- 큰 제목, 본문, 보조 설명과 상태 문구를 구분합니다. 한국어 문장은 자연스럽게 줄바꿈하며 예시 화면의 줄 수에 맞추려고 내용을 자르지 않습니다.
- 배경과 카드의 명도 차이, 제목과 보조 정보의 색 차이로 위계를 만듭니다. 파란색, 빨간색, 초록색만으로 상태를 전달하지 않습니다.
- 여백과 둥근 모서리는 정보 그룹을 정돈하는 데 사용합니다. 의미 없는 장식, 중첩된 반투명 배경, 화면을 가리는 고정 요소는 추가하지 않습니다.
- 실제 상태에 따라 빈 화면, 진행 중, 오류, 선택, 비활성 상태를 표현합니다. 의료 정보의 출처, 주의사항, 저장 상태와 권한 경계를 화면 장식보다 우선합니다.

## 색상

공통 팔레트는 [`apps/mobile/src/layout/appColors.ts`](apps/mobile/src/layout/appColors.ts)의 `appColorPalettes`와 `appColors`입니다. 새 화면에서 임의의 HEX 값을 만들지 말고 의미가 맞는 토큰을 사용하세요.

| 역할 | 라이트 | 다크 | 사용 |
| --- | --- | --- | --- |
| `primary` | `#3182f6` | `#3182f6` | 강조 아이콘과 시스템 틴트 |
| `primaryAction` | `#1b64da` | `#1b64da` | 채운 주요 행동 |
| `onPrimary` | `#ffffff` | `#ffffff` | `primaryAction` 위의 내용 |
| `primaryText` | `#1b64da` | `#9fc2ff` | 링크와 채우지 않은 강조 |
| `primarySoft` | `#e8f3ff` | `#18365a` | 약한 강조 배경 |
| `background` | `#f2f4f6` | `#101318` | 화면 바탕 |
| `surface` | `#ffffff` | `#1c222a` | 카드와 입력 영역 |
| `text` | `#191f28` | `#f2f4f6` | 기본 내용 |
| `secondary` | `#5e6875` | `#a1acb8` | 보조 설명과 메타데이터 |
| `border` | `#e5e8eb` | `#38424e` | 구분선과 외곽선 |
| `warning` | `#704800` | `#ffd89e` | 주의 문구 |
| `warningSurface` | `#fff4d6` | `#3a2d18` | 주의 영역 배경 |
| `danger` | `#8a1c1c` | `#ffb4ab` | 오류와 위험 문구 |
| `dangerSurface` | `#fde8e8` | `#48211f` | 오류 영역 배경 |
| `dangerAction` | `#b3261e` | `#b3261e` | 파괴적 행동의 채움 |
| `onDanger` | `#ffffff` | `#ffffff` | `dangerAction` 위의 내용 |

iOS에서 `primaryText`, 상태 색상, 배경, 표면, 텍스트, 보조색, 테두리는 `DynamicColorIOS`로 시스템 라이트/다크 모드를 따릅니다. `primary`, `primaryAction`, `onPrimary`, `dangerAction`, `onDanger`는 두 팔레트에서 고정 값입니다. 다른 플랫폼은 현재 라이트 팔레트를 사용합니다.

[`appColors.test.ts`](apps/mobile/src/layout/__tests__/appColors.test.ts)는 본문, 표면, 보조 문구, 주요 행동, 경고와 위험 색상 중 정해진 조합의 대비를 4.5:1 이상으로 검사합니다. 이 테스트는 반투명 표면을 포함한 모든 화면의 대비나 실제 기기의 가독성을 증명하지 않습니다. 색상이나 배경을 함께 바꾸면 해당 조합을 다시 확인하세요.

다음 진료 질문 기능에는 별도의 [`NextVisitQuestionsTheme`](apps/mobile/src/nextVisitQuestions/types.ts)가 있습니다. 여기에 정의된 색상, 간격, 모서리, 글자 크기는 해당 기능에만 적용되는 토큰입니다. 공통 API로 승격되기 전에는 앱 전체의 공유 토큰이라고 부르지 마세요. 테마 색상은 [`nextVisitQuestionsRoutePresentation.ts`](apps/mobile/src/aiFeatures/integration/nextVisitQuestionsRoutePresentation.ts)에서 문자열로 구성하므로 팔레트를 바꿀 때 함께 확인해야 합니다.

## 글자와 Dynamic Type

화면 글자는 시스템 글꼴을 사용합니다. 현재 [`AppText`](apps/mobile/src/layout/AppText.tsx)는 기본 글자색을 제공하고, 글자 크기나 위계 토큰은 제공하지 않습니다. 화면별 예시는 홈, 기록, 일정 제목 40pt, 공통 오류 경로 제목 24pt, 본문 15~16pt, [`AppButton`](apps/mobile/src/layout/AppButton.tsx) 라벨 17pt입니다. 다음 진료 질문 기능은 자체 테마에서 제목 30pt, 본문 16pt, 캡션 13pt를 사용합니다.

새 화면은 제목, 본문, 보조 정보의 역할을 먼저 정하고 인접 화면의 크기와 줄 간격을 맞춥니다. 글자 크기를 시스템 설정에 따라 키울 수 있게 두고, 고정 높이와 한 줄 제한 때문에 내용이 잘리지 않도록 합니다. 긴 한국어 문장, 큰 글자, 버튼 라벨은 실제 화면에서 확인합니다. `allowFontScaling={false}`로 시스템 글자 크기 조절을 막지 않습니다.

네이티브 UIKit에서 직접 만든 텍스트도 큰 글자 설정을 따라야 합니다. PR #186에서 추가한 루트 탭 라벨은 현재 소스에서 `UILabel`에 고정 12pt 시스템 글꼴을 설정하며 콘텐츠 크기 범주에 맞춰 키우는 설정은 보이지 않습니다. 큰 글자에서 탭 라벨이 커지는지는 확인되지 않았습니다. 이 차이의 후속 확인 소유자는 이슈 #187 담당자 `eunsoogi`입니다.

## 간격, 모서리, 아이콘과 터치 영역

앱 전체에서 공유하는 간격이나 모서리 토큰 모듈은 아직 없습니다. 기존 화면에는 8, 12, 16, 20, 24pt 간격과 12~20pt 카드 모서리가 반복됩니다. 새 화면은 이 범위와 주변 화면의 밀도를 따르되, 새 값을 공통 토큰처럼 선언하지 않습니다. 다음 진료 질문 테마의 `xs` 4pt, `sm` 8pt, `md` 12pt, `lg` 16pt, `xl` 20pt, `xxl` 24pt와 12pt 모서리는 그 기능의 로컬 값입니다.

기존 공통 컴포넌트의 치수는 다음과 같습니다.

- `AppButton`: 최소 높이 52pt, 모서리 16pt, 좌우 여백 18pt.
- `NavigationActionButton`: 최소 높이 50pt, 최소 너비 72pt, 모서리 24pt.
- `NavigationGlassSurface`: 기본 내비게이션 표면 48pt, 비네이티브 대체 표면 모서리 28pt.
- `CheckboxIndicator`: 44pt 터치 영역 안에 26pt 기호를 둡니다.

아이콘은 [`AppSymbol`](apps/mobile/src/layout/AppSymbol.tsx)의 SF Symbols 브리지를 우선 사용합니다. 기본 크기는 20pt이고 화면에서 명시적으로 크기를 지정할 수 있습니다. 이 기호는 장식 요소로 접근성 트리에서 숨겨지므로, 버튼이나 행에 설명 가능한 접근성 이름을 설정하세요.

실제 터치 영역은 최소 44pt를 유지합니다. 눈에 보이는 아이콘 크기만으로 터치 영역을 판단하지 않습니다. 선택된 탭은 기호와 라벨을 함께 구분하고, 선택 상태를 접근성 속성에도 반영합니다.

## 공통 API와 화면 예시

| API | 역할과 경계 |
| --- | --- |
| [`AppText`](apps/mobile/src/layout/AppText.tsx) | 기본 텍스트 색상을 적용합니다. 크기와 제목 단계는 화면 스타일이 정합니다. |
| [`AppButton`](apps/mobile/src/layout/AppButton.tsx) | 주요/보조 버튼, 비활성 상태, 접근성 이름을 제공합니다. 공통 로딩 또는 파괴적 변형은 없습니다. |
| [`AppSymbol`](apps/mobile/src/layout/AppSymbol.tsx) | 장식용 SF Symbol을 표시합니다. 상위 컨트롤이 접근성 이름을 가져야 합니다. |
| [`CheckboxIndicator`](apps/mobile/src/layout/CheckboxIndicator.tsx) | 체크 표시를 그립니다. 선택 상태와 터치는 상위 컨트롤이 소유합니다. |
| [`NavigationActionBar`](apps/mobile/src/navigation/NavigationActionBar.tsx) | 루트 탭 또는 뒤로, 홈, 주요 행동을 공유 내비게이션 표면에 연결합니다. |
| [`SafeAreaLayout`](apps/mobile/src/layout/SafeAreaLayout.tsx) | 공통 내비게이션 셸을 사용하지 않는 독립 화면의 안전 영역과 스크롤을 처리합니다. |

예를 들어 [`WelcomeRoute`](apps/mobile/src/routes/WelcomeRoute.tsx)는 실제 예약과 기록 상태를 카드, 빈 상태, 오류와 다시 시도로 나눕니다. [`RecordsRoute`](apps/mobile/src/routes/RecordsRoute.tsx)는 기록과 가져오기 행동을 묶습니다. [`RouteLoadError`](apps/mobile/src/routes/RouteLoadError.tsx)는 복구 가능한 오류를 제목, 알림, 다시 시도로 표현합니다. 입력 화면은 [`AppointmentForm`](apps/mobile/src/appointments/AppointmentForm.tsx)의 라벨과 상태 처리를 참고합니다. 공통 입력 컴포넌트는 현재 없습니다.

## 상태와 상호작용

| 상태 | 표현 규칙 |
| --- | --- |
| 진행 중 | 콘텐츠가 준비될 때까지 상태 문구나 진행 표시를 보여 줍니다. 비동기 행동이면 접근성 상태를 `busy`로 알립니다. |
| 빈 상태 | 오류와 구분하고, 데이터가 없다는 사실과 가능한 다음 행동을 설명합니다. |
| 오류 | `danger`를 사용하고 오류 내용을 알립니다. 다시 시도할 수 있으면 실제 복구 행동을 제공합니다. |
| 비활성 | 이유와 상태를 유지하고 접근성 상태에 `disabled`를 반영합니다. 투명도 변화만으로 상태를 전달하지 않습니다. |
| 선택 | 배경이나 기호 등 색상 외의 변화와 접근성 선택 상태를 함께 제공합니다. |
| 파괴적 행동 | 삭제나 취소의 결과를 분명히 설명하고 필요한 경우 네이티브 확인을 사용합니다. `danger`를 일반 오류가 아닌 강조색으로 쓰지 않습니다. |

현재 `AppButton`은 `primary`와 `secondary` 변형만 제공합니다. 로딩과 파괴적 행동은 개별 화면의 상태 및 네이티브 확인 흐름으로 처리합니다. 새 공통 변형이 필요하면 관련 사용처와 대비를 먼저 정리한 별도 변경으로 추가합니다.

## 내비게이션, 안전 영역과 키보드

공통 경로는 [`NavigationRouteAdapter`](apps/mobile/src/navigation/NavigationRouteAdapter.tsx), [`NavigationViewport`](apps/mobile/src/navigation/NavigationViewport.tsx), [`NavigationRouteScrollView`](apps/mobile/src/navigation/NavigationRouteScrollView.tsx), [`NavigationActionBar`](apps/mobile/src/navigation/NavigationActionBar.tsx)입니다. 화면 높이를 줄여 고정 막대를 넣지 않습니다. `NavigationViewport`가 실제 막대 높이를 측정하고, 화면 스크롤은 그만큼 아래 콘텐츠를 비워 마지막 내용이 가려지지 않게 합니다. 공통 부모가 안전 영역을 처리하면 화면에서 같은 inset을 다시 더하지 않습니다.

독립 화면은 [`SafeAreaLayout`](apps/mobile/src/layout/SafeAreaLayout.tsx)을 사용합니다. 스크롤 화면은 `automaticallyAdjustKeyboardInsets`와 `keyboardShouldPersistTaps="handled"`를 유지하고, 폼에 맞는 `KeyboardAvoidingView` 동작을 확인합니다. 입력 중 키보드가 주요 행동을 가리거나 스크롤을 막지 않아야 합니다.

iOS 내비게이션 표면은 [`NavigationGlassView.swift`](apps/mobile/ios/Navigation/NavigationGlassView.swift)의 시스템 `UIToolbar`를 사용하고 기본 표면 외관을 직접 덮어쓰지 않습니다. 지원 iOS에서 주요 네이티브 행동은 UIKit의 Glass 구성을 사용합니다. 별도의 blur나 반투명 View를 중첩하지 않습니다. 앱의 비네이티브 대체 표면은 React Native View이므로 네이티브 Liquid Glass와 동일한 재질이라고 설명하지 않습니다.

루트 탭은 다섯 개이며 항목과 접근성 이름은 [`rootTabs.ts`](apps/mobile/src/navigation/rootTabs.ts)에 있습니다. 네이티브 탭 구성은 [`NavigationGlassComponents.swift`](apps/mobile/ios/Navigation/NavigationGlassComponents.swift)와 [`NavigationGlassView.swift`](apps/mobile/ios/Navigation/NavigationGlassView.swift), JavaScript 대체 탭은 [`RootTabActions.tsx`](apps/mobile/src/navigation/RootTabActions.tsx), 높이 상수는 [`navigationLayout.ts`](apps/mobile/src/navigation/navigationLayout.ts)에 있습니다. 루트 탭과 화면 안의 뒤로/홈/주요 행동은 같은 표면을 사용하지만 크기와 선택 동작은 구분합니다. 아래 값은 2026-10-12 기준 병합된 `main`의 구현입니다.

| 항목 | 네이티브 iOS | JavaScript 대체 화면 |
| --- | --- | --- |
| 루트 탭 표면 | `ROOT_TAB_SURFACE_HEIGHT` 56pt | 항목 최소 높이 48pt와 표면 위아래 여백 각각 4pt; 큰 글자에서는 더 커질 수 있음 |
| 기호와 라벨 | SF Symbol 22pt medium, `UILabel` 12pt medium, 간격 4pt | 기호 22pt/줄 24pt, 라벨 12pt/줄 16pt, 간격 2pt |
| 선택 표시 | 기호와 라벨을 감싸는 캡슐형 배경, `secondarySystemFill`과 모드에 맞는 전경색; 다크 모드 고대비에서는 더 밝게 조정 | 반경 24pt 캡슐형 배경, `primaryAction` 배경과 `onPrimary` 전경색 |
| 터치 영역 | 버튼 높이 48pt, 너비 최소 44pt | 항목 최소 높이와 너비 각각 48pt, 44pt |
| 재질과 선택 강조 | `UIToolbar`가 시스템 재질을 제공하며 iOS 26 이상에서 선택/주요 버튼은 `.prominentGlass()`, 이전 iOS에서는 `.filled()`, 나머지는 `.plain()` | React Native `View`; 네이티브 Liquid Glass 재질은 제공하지 않음 |

상세 화면의 기본 내비게이션 표면은 `NAVIGATION_SURFACE_HEIGHT` 48pt이고, 루트 탭 표면은 56pt입니다. 두 값을 혼용하지 마세요. 네이티브 선택 탭은 iOS 시스템 채움색을 쓰고, JavaScript 대체 화면은 앱의 주요 행동색을 쓰므로 선택 색상은 플랫폼별로 다릅니다. 이는 현재 구현 차이이며, 같은 색으로 맞춰야 한다는 승인된 규칙은 확인되지 않았습니다. 후속 확인 소유자는 이슈 #187 담당자 `eunsoogi`입니다.

PR #186의 최종 증거에는 iPhone Air와 iPhone SE 시뮬레이터에서 다섯 탭을 확인한 라이트 모드 캡처, iPhone Air의 다크 모드·높은 대비·투명도 감소 캡처, 그리고 iOS 27의 iPhone 18 Pro 시뮬레이터에서 통과한 15개 Release UI/저장소 E2E가 포함됩니다. 실기기 수용 확인과 VoiceOver 발화는 관찰되지 않았습니다. 이전 중간 캡처는 병합된 구현의 최신 근거로 사용하지 말고, [PR #186](https://github.com/eunsoogi/orot/pull/186)의 최종 캡처와 결과를 참고하세요.

루트 탭 선택과 상세 화면의 뒤로/홈/주요 행동은 다른 역할입니다. 루트 탭 스타일을 상세 액션에 적용하지 말고, 기존 경로, 저장되지 않은 입력 확인, 녹음 중 전환 제한을 보존합니다.

## 접근성과 시각 설정

- 버튼, 입력, 목록 행에 실제 동작을 설명하는 접근성 이름, 역할과 상태를 설정합니다. 제목은 헤더, 오류는 알림으로 표시합니다.
- 기호가 장식용이면 상위 컨트롤이 의미를 전달해야 합니다. 상태 색상은 텍스트나 기호, 선택 모양과 함께 사용합니다.
- 큰 글자에서 제목, 버튼, 입력, 마지막 스크롤 콘텐츠가 잘리지 않는지 확인합니다.
- 라이트와 다크 모드를 확인하고, 반투명 표면의 텍스트가 배경 위에서 읽히는지 검사합니다.
- 높은 대비와 Reduce Transparency가 켜져도 의미와 조작 방법이 유지되어야 합니다. 네이티브 `UIToolbar`는 시스템 재질을 따르고 JS 대체 표면은 직접 지정한 색상을 사용하므로 두 화면의 실제 동작을 각각 확인합니다.
- 화면 캡처는 보이는 배치만 증명합니다. VoiceOver 발화, 터치 영역, 저장/취소 동작, 접근성 설정 대응은 해당 설정이 켜진 실제 실행 검증이 필요합니다.

PR #186의 시뮬레이터 검사는 라이트/다크, 높은 대비, Reduce Transparency와 내비게이션을 다룹니다. 캡처는 시각 상태만 보여 주며 VoiceOver 발화, 물리 기기 동작, 저장/취소 동작 또는 접근성 설정 대응 전부를 증명하지 않습니다. 날짜가 있는 기존 [QA 보고서](design-qa.md)는 PR #167의 저장 질문과 가져오기 화면을 다루므로 #181 탭 검증으로 간주하지 않습니다.

## 알려진 차이와 후속 소유자

| 차이 또는 한계 | 근거 | 후속 소유자 |
| --- | --- | --- |
| 네이티브 루트 탭 라벨은 고정 12pt `UILabel`이며 콘텐츠 크기 범주에 맞춰 커지는 설정이 보이지 않습니다. | [`NavigationGlassComponents.swift`](apps/mobile/ios/Navigation/NavigationGlassComponents.swift) | 이슈 #187 담당자 `eunsoogi` |
| 선택 배경과 재질은 네이티브와 JavaScript 대체 화면에서 다릅니다. 네이티브는 `secondarySystemFill`과 시스템 재질, JavaScript는 파란 `primaryAction`을 사용합니다. | [`NavigationGlassView.swift`](apps/mobile/ios/Navigation/NavigationGlassView.swift), [`RootTabActions.tsx`](apps/mobile/src/navigation/RootTabActions.tsx) | 이슈 #187 담당자 `eunsoogi` |
| 다음 진료 질문 테마는 경고, 성공, 위험 색상 값을 공통 팔레트와 별도로 문자열로 구성합니다. | [`nextVisitQuestionsRoutePresentation.ts`](apps/mobile/src/aiFeatures/integration/nextVisitQuestionsRoutePresentation.ts), [`appColors.ts`](apps/mobile/src/layout/appColors.ts) | 이슈 #187 담당자 `eunsoogi` |
| 앱 전체 공통 간격, 모서리, 글자 크기 토큰과 입력 컴포넌트는 없습니다. 다음 진료 질문 기능에는 별도의 토큰 계약이 있습니다. | [`AppText.tsx`](apps/mobile/src/layout/AppText.tsx), [`NextVisitQuestionsTheme`](apps/mobile/src/nextVisitQuestions/types.ts) | 이슈 #187 담당자 `eunsoogi` |

이 문서 변경은 위 차이를 설명하는 범위입니다. 내비게이션 또는 화면 코드를 바꾸려면 해당 소유자가 별도 범위와 검증 근거를 정한 뒤 진행합니다.

## 새 화면 확인 목록

- 색상은 `appColors`의 의미 토큰으로 표현했는가?
- 제목, 본문, 보조 정보가 구별되고 큰 글자에서 잘리지 않는가?
- 콘텐츠에 빈 상태, 진행 중, 오류, 비활성, 선택과 파괴적 상태가 있는가?
- 버튼과 입력에 접근성 이름, 역할, 상태가 있고 터치 영역은 최소 44pt인가?
- 안전 영역, 하단 내비게이션, 키보드가 마지막 내용이나 주요 행동을 가리지 않는가?
- 라이트, 다크, 큰 글자, 필요한 경우 높은 대비와 Reduce Transparency에서 화면을 확인했는가?
- 검증 근거에 캡처 날짜, 앱 revision, 기기와 실행 범위를 남기고 시안과 실제 앱 캡처를 구분했는가?
