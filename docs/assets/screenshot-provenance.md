# 소개 이미지 출처

## 실제 앱 화면

- 원본: [`source/ai-features.png`](source/ai-features.png)
- 원본 SHA-256: `83e39bab53265ed331ddbd5a2214fba9117a6297036ed04855a2299b8aa99f61`
- 앱 소스 기준 커밋: `6700d575be2e29e6ee41ca5fc8bbb82b1303cbeb`
- 캡처 시각: 2026-10-11 08:39:07 UTC (17:39:07 KST)
- 실행 환경: iPhone Air Simulator, iOS 27.0 (runtime build `24A434`), 기기 ID `28D89DC3-2A3D-43CD-A59B-955322F0F796`
- 장면: 앱의 `AI 도우미` 목록. 다음 진료 질문, 증상 정리, 기록과 대화, 의학 자료 찾기 네 항목과 의료진 진단을 대신하지 않는다는 안내가 보입니다.
- 이 새 시뮬레이터에는 사용자 건강 기록이나 계정이 없습니다. 화면은 실제 앱을 Release 구성으로 실행해 캡처했으며, 이 캡처는 기능 목록 UI만 증명합니다.

새 시뮬레이터에서도 홈 예약과 녹음 기록, 다음 진료 질문 화면의 예약 정보, 제공자 선택 상태를 불러오지 못했습니다. 그래서 해당 오류 화면은 소개 이미지에서 제외했고, 합성 예약이나 계정 정보를 실제 앱 데이터처럼 만들지 않았습니다.

## 앱 아이콘 원본

- 파일: [`../../apps/mobile/ios/OrotMobile/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`](../../apps/mobile/ios/OrotMobile/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png)
- SHA-256: `294b12ce6558350f6627ccb3ed61e5a048333e6b34029d0cb64ce04a5518114d`

## 생성한 소개 이미지

- 파일: [`orot-hero.png`](orot-hero.png)
- SHA-256: `3eb31e4a134ea2fc0c490e62c3dc578c47a3f8e36176789912e693168ba81711`
- 크기: 1672 × 941 px
- 편집 입력: 이전 소개 이미지 초안 SHA-256 `d601bdf9786177aa484349276aec6729286e3dc3d38b6f1bb5abdd866b15dba3`, 위 앱 아이콘 원본, 실제 앱 화면 원본.
- 소개 이미지는 실제 화면과 아이콘을 참고해 생성한 합성 이미지입니다. 화면의 실제 상태와 픽셀은 위 원본 PNG를 기준으로 확인하세요.

### 최종 편집 프롬프트

```text
Edit the first reference image to balance the composition. Do not place the brand block in the upper-left corner. Move the entire brand block (blue app icon, Korean name, and description together) downward and inward so it is centered within the open left half and visually balances the phone on the right. Center the brand block around the middle height of the canvas, with comfortable margins above and below; place the icon above the name “오롯” and the exact one-line description “상담과 건강 기록을 모아, 다음 진료를 준비합니다” directly below the name. Align all three elements around the center of the left half. Keep the tagline on one horizontal line. Keep the blue rounded-square app icon directly on the pale blue background with a soft shadow, no white card behind it. Do not write the Latin word Orot anywhere. Keep the iPhone on the right and preserve the actual AI feature screen from reference three as closely as possible, without changing, inventing, or replacing screen text, feature cards, icons, disclaimer, or navigation. Keep the real app icon recognizable from reference two. Add no other text, badges, symbols, cards, or logos. Preserve the wide 1672-by-941 landscape composition and calm blue-white lighting.
```
