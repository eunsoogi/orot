# 공용 차트 기반 작업 기록

이 문서는 공용 기반의 현재 범위와 아직 검증되지 않은 경계를 기록합니다. 화면 이전은 #699와 #700이 담당합니다.

## 기존 화면과 데이터 소유권

- Home의 `HomeMetrics`는 수면, 심박수, 체중, 걸음 카드를 `HomeMetricCard`로 표시합니다. `metricProjection`은 일별 값과 부분 상태를 소유합니다. 화면 이전은 #699가 담당합니다.
- 건강 기록의 `HealthRecordsCategoryCard`는 `HealthRecordsCategoryCharts`를 통해 혈압, 심박수, 걸음, 체중 차트를 표시합니다. `healthRecordsChartModel`은 관측값을 계열로 분류하고, `HealthRecordsCategoryCharts`는 단위별 차트를 분리합니다. 화면 이전은 #700이 담당합니다.
- 상세 기록은 목록과 기간 선택을 제공하며 현재 차트가 없습니다. 녹음 파형, 진행 표시, 일정과 사건 중심 요약은 통계 차트 이전 범위가 아닙니다.

## 후보와 현재 제한

첫 후보는 MIT 라이선스의 `react-native-chart-kit` 7.0.4 `/v2`와 `react-native-svg` 15.16.1입니다. Chart Kit의 peer 범위는 React 19.2.3과 React Native 0.87.1을 포함합니다. SVG의 명시 범위만으로 호환성을 확정하지 않으며, 실제 새 아키텍처 컴파일과 Simulator 화면을 별도로 확인합니다. [Chart Kit 패키지](https://registry.npmjs.org/react-native-chart-kit/7.0.4), [SVG 호환성](https://github.com/software-mansion/react-native-svg#supported-react-native-versions)을 참조하세요.

Chart Kit은 모든 계열을 공통 행으로 정규화하므로 다른 계열의 시각에서 빠진 값과 명시적 null이 같아집니다. 시제품은 명시적 null에서 계열을 구간으로 나누고 구간 내의 다른 시각을 건너뜁니다. 실제 숫자를 보간하거나 새 측정값을 만들지 않습니다. 표시용 범례와 값 목록은 구간이 아닌 원래 계열을 사용합니다.

[Gifted Charts 1.4.81](https://registry.npmjs.org/react-native-gifted-charts/1.4.81)은 독립 데이터 배열과 숫자 x 값을 제공하지만 peer 범위가 wildcard이며, 결측 보간이 기본으로 켜져 있어 명시적으로 꺼야 합니다. 해당 조합의 네이티브 실행은 아직 확인하지 않았습니다. [Victory Native 43.0.1](https://registry.npmjs.org/victory-native/43.0.1)은 명시적 React 및 React Native 범위를 제공하지만 Skia, Reanimated, Worklets와 Gesture Handler를 추가로 요구합니다. 어느 후보도 선언된 peer 범위만으로 호환성을 입증하지 않습니다.

현재 `ChartPlot`은 입력 계열과 단위, 요청 및 표시 범위, 원본과 부분 상태를 받습니다. 시간축은 실제 시각을, 막대는 일별 범주를 사용합니다. 권한이 없어진 상태에서는 이전 값을 숨기고, 로딩 중에는 전달받은 유효 값을 유지합니다. 그래프 조작을 요구하지 않는 값 목록을 제공합니다. 큰 글자에서 축과 그래프가 겹치는 것을 피하기 위해 그래프 대신 전체 값 목록을 표시합니다. 날짜와 값의 현지화 함수 및 상태 문구는 호출자가 제공하므로 두 화면의 공통 형식 통합은 아직 필요합니다.

이 구현은 아직 화면 이전에 사용할 준비가 아닙니다. 조밀한 자료의 성능과 보존 정책, 실제 VoiceOver 발화, Reduce Motion, 좁은 화면과 스크롤·선택의 네이티브 검증, 모든 상태와 출처 표시의 계약이 남아 있습니다. 자동 검사와 Simulator 스크린샷은 이 항목을 대신하지 않습니다. 이 저장소의 기존 차트는 두 화면 이전 이슈에서 제거합니다.
