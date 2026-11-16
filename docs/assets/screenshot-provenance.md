# 소개 이미지 출처

## 대화 중심 소개 화면: 2026-11-15

- 앱 소스: `0593f968b60173d6912587c2bffbde5258a3b285`. 대화 제목 제거(#1037) 이후의 실제 화면입니다.
- 구성: Release OrotTests, `OROT_TEST_SCENARIO conversation-visual`. 실제 production 화면 컴포넌트와 공개용 합성 기록·응답을 사용합니다. 원격 모델 호출과 개인 건강정보는 없습니다.
- 질문: `기록 요약`. 화면의 출처 버튼은 합성 기록을 가리킵니다. 실제 모델의 의료적 해석 품질을 입증하는 예시가 아닙니다.
- 일반 iPhone: iPhone 18 Pro / iOS 27.0 / 세로 1206 × 2622.
- [iphone-conversation.png](showcase/iphone-conversation.png): 2026-11-15T13:00:39Z, SHA-256 `56eebc558e7018acff0ae4e6dd8906867da5b9049f75dfa750c461cbb033b3bf`.
- iPhone 원본은 전용 시뮬레이터에서 촬영하고 삭제를 확인했습니다.
- Duo 원본은 iOS 27.3 실기기의 **접힌 외부 화면**, 세로 1398 × 2034입니다. 펼친 내부 화면 캡처가 아닙니다.
- [duo-conversation.png](showcase/duo-conversation.png): 2026-11-15T14:08:42Z, SHA-256 `858280ef4ff372978836d126206e5db1183d9ec5a4502e7dfb5de8008243e170`.
- Duo 구성은 `deviceReadmeVisualProbe`: 실제 `ConversationScreen`과 메모리 전용 합성 세션을 사용하고 production 앱 루트는 포함하지 않습니다. JS/native 네트워크·음성·다운로드와 production DB 접근을 차단한 테스트 구성입니다.
- 공개용 원본에는 고정 합성 기록·응답과 일반 시계·배터리 표시만 있습니다. 사용자 알림, 계정, 실제 건강 기록과 데스크톱은 포함하지 않습니다. 촬영 후 서명된 production 앱을 복원했습니다.

## 보조 한눈에 화면: 2026-11-15

- 앱 소스: `122c901dd68b0694ba3caf7b5d67f54e718dd169` (#1029), 당시 main `6e299ff` 기반. 최근 기록 PR #1032 화면은 포함하지 않습니다.
- 구성: Release OrotTests, 테스트 전용 진입점에서 **실제 production 화면 컴포넌트** 실행. SDK 27.2 / arm64, build-for-testing 성공, blocking warning 0.
- 일반 iPhone: iPhone 18 Pro / iOS 27.0 / 세로 1206 × 2622.
- iPhone Duo: iOS 27.1 / 펼친 가로 화면 / display 3 / 2853 × 2007.
- 한눈에: `medical-appointment-app-navigation`과 `OROT_HOME_APPOINTMENT_TIMING=YES`의 합성 일정·수면·심박수.
- 원본 PNG는 픽셀을 수정하지 않고 보관합니다. 아래 일시는 UTC이며 한국 시각은 +9시간입니다.

| 원본                                                | 촬영 시각 (UTC)                  | SHA-256                                                            |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| [duo-overview.png](showcase/duo-overview.png)       | 2026-11-15T11:05:27.048251+00:00 | `ebf90293649b3ea369fdafe35b22e00744d9ff1363f199d2ad313b68ef4f6364` |
| [iphone-overview.png](showcase/iphone-overview.png) | 2026-11-15T11:02:37.399026+00:00 | `f935bece8bd737e2a830dddc02274339a1ce97bbf1ee90f2db3f016bb4f0157a` |

- 한눈에 원본은 위 촬영 시점 그대로 보존한 보조 소개 화면입니다. 대화 원본과 소스·촬영 시점이 다릅니다.

### 최종 소개 이미지

- [orot-showcase.png](orot-showcase.png): 1800 × 1200. 코드 기반 벡터 레이아웃의 타이포·배경·프레임 안에 실제 PNG를 종횡비를 유지해 배치했습니다. 화면 내부를 생성형 AI로 다시 그리거나 내용을 합성하지 않았습니다.
- 원본 앱 아이콘, 일반 iPhone 대화와 Duo 접힌 외부 대화 화면을 사용합니다. 원본 전체는 위 링크로 확인할 수 있습니다.
- 이것은 README의 최종 소개 자산이며 제품 UI 목업이 아닙니다.
- 각 대화 화면의 촬영 환경과 안전 경계는 위에 명시했습니다. 보조 한눈에 갤러리는 이전 시뮬레이터 원본을 유지합니다.

## 이전 소개 이미지 이력 (현재 대문에서 미사용)

### 실제 앱 화면

- 원본: [`source/ai-features.png`](source/ai-features.png)
- 원본 SHA-256: `83e39bab53265ed331ddbd5a2214fba9117a6297036ed04855a2299b8aa99f61`
- 앱 소스 기준 커밋: `6700d575be2e29e6ee41ca5fc8bbb82b1303cbeb`
- 캡처 시각: 2026-10-11 08:39:07 UTC (17:39:07 KST)
- 실행 환경: iPhone Air Simulator, iOS 27.0 (runtime build `24A434`), 기기 ID `28D89DC3-2A3D-43CD-A59B-955322F0F796`
- 장면: 앱의 `AI 도우미` 목록. 다음 진료 질문, 증상 정리, 기록과 대화, 의학 자료 찾기 네 항목과 의료진 진단을 대신하지 않는다는 안내가 보입니다.
- 이 새 시뮬레이터에는 사용자 건강 기록이나 계정이 없습니다. 화면은 실제 앱을 Release 구성으로 실행해 캡처했으며, 이 캡처는 기능 목록 UI만 증명합니다.

새 시뮬레이터에서도 홈 예약과 녹음 기록, 다음 진료 질문 화면의 예약 정보, 제공자 선택 상태를 불러오지 못했습니다. 그래서 해당 오류 화면은 소개 이미지에서 제외했고, 합성 예약이나 계정 정보를 실제 앱 데이터처럼 만들지 않았습니다.

### 앱 아이콘 원본

- 파일: [`../../apps/mobile/ios/OrotMobile/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`](../../apps/mobile/ios/OrotMobile/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png)
- SHA-256: `294b12ce6558350f6627ccb3ed61e5a048333e6b34029d0cb64ce04a5518114d`

### 생성한 소개 이미지

- 파일: [`orot-hero.png`](orot-hero.png)
- SHA-256: `3eb31e4a134ea2fc0c490e62c3dc578c47a3f8e36176789912e693168ba81711`
- 크기: 1672 × 941 px
- 편집 입력: 이전 소개 이미지 초안 SHA-256 `d601bdf9786177aa484349276aec6729286e3dc3d38b6f1bb5abdd866b15dba3`, 위 앱 아이콘 원본, 실제 앱 화면 원본.
- 소개 이미지는 실제 화면과 아이콘을 참고해 생성한 합성 이미지입니다. 화면의 실제 상태와 픽셀은 위 원본 PNG를 기준으로 확인하세요.

#### 최종 편집 프롬프트

```text
Edit the first reference image to balance the composition. Do not place the brand block in the upper-left corner. Move the entire brand block (blue app icon, Korean name, and description together) downward and inward so it is centered within the open left half and visually balances the phone on the right. Center the brand block around the middle height of the canvas, with comfortable margins above and below; place the icon above the name “오롯” and the exact one-line description “상담과 건강 기록을 모아, 다음 진료를 준비합니다” directly below the name. Align all three elements around the center of the left half. Keep the tagline on one horizontal line. Keep the blue rounded-square app icon directly on the pale blue background with a soft shadow, no white card behind it. Do not write the Latin word Orot anywhere. Keep the iPhone on the right and preserve the actual AI feature screen from reference three as closely as possible, without changing, inventing, or replacing screen text, feature cards, icons, disclaimer, or navigation. Keep the real app icon recognizable from reference two. Add no other text, badges, symbols, cards, or logos. Preserve the wide 1672-by-941 landscape composition and calm blue-white lighting.
```
