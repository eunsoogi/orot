# 소개 이미지 출처

## 실제 앱 화면

- 원본: [`source/ai-features.png`](source/ai-features.png)
- 원본 SHA-256: `83e39bab53265ed331ddbd5a2214fba9117a6297036ed04855a2299b8aa99f61`
- 앱 소스 기준 커밋: `6700d575be2e29e6ee41ca5fc8bbb82b1303cbeb`
- 캡처 시각: 2026-10-11 08:39:07 UTC (17:39:07 KST)
- 실행 환경: iPhone Air Simulator, iOS 27.0 (runtime build `24A434`), 기기 ID `28D89DC3-2A3D-43CD-A59B-955322F0F796`
- 장면: 앱의 `AI 도우미` 목록. 다음 진료 질문, 증상 정리, 기록과 대화, 의학 자료 찾기 네 항목과 의료진 진단을 대체하지 않는다는 안내가 보입니다.
- 이 새 시뮬레이터에는 사용자 건강 기록이나 계정이 없습니다. 화면은 실제 앱을 Release 구성으로 실행해 캡처했으며, 이 캡처는 기능 목록 UI만 증명합니다.

새 시뮬레이터에서도 홈 예약과 녹음 기록, 다음 진료 질문 화면의 예약 정보, 제공자 선택 상태를 불러오지 못했습니다. 그래서 해당 오류 화면은 소개 이미지에서 제외했고, 합성 예약이나 계정 정보를 실제 앱 데이터처럼 만들지 않았습니다.

## 생성한 소개 이미지

- 파일: [`orot-hero.png`](orot-hero.png)
- SHA-256: `648ce91facbb430ea5cc4f4246db36871798be69b09562c6f51632727e1e24fe`
- 크기: 1672 × 941 px
- 생성 입력: 위의 실제 화면 원본. 화면을 식별할 수 있는 소개용 합성 이미지이며, 원본 앱 UI 자체를 픽셀 단위로 보존한 캡처는 아닙니다. 정확한 문구와 화면 상태는 원본 PNG를 기준으로 확인하세요.

### 생성 프롬프트

```text
Create a polished 16:9 landscape hero image for the open-source Korean health-record app Orot, using the provided image as the exact screen reference. Show one modern black iPhone in a three-quarter front view, large and crisp, with the provided AI Assistant screen on its display. Preserve the complete screen as faithfully as possible: Korean text, all four feature cards, icons, typography, active blue AI tab, and medical disclaimer must remain recognizable and unaltered. Do not invent or redraw any app UI, do not add text inside the phone, do not crop or replace screen content. Compose the phone slightly right of center on a quiet pale blue-gray background with soft mint and sky-blue gradients, subtle translucent paper-like curves, and gentle natural shadows. Keep the background minimal and premium, like an App Store editorial image. No people, no medical cross, no hospital imagery, no pills, no fake charts, no extra screens, no unsupported feature claims, no logos or text outside the phone. The real Orot screen is the only product evidence.
```
