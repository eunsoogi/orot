# 공용 차트 기반 작업 기록

이 문서는 공용 기반의 현재 범위와 아직 검증되지 않은 경계를 기록합니다. 화면 이전은 #699와 #700이 담당합니다.

## 기존 화면과 데이터 소유권

- 한눈에의 `OverviewMetrics`는 수면, 심박수, 체중, 걸음 카드를 `OverviewMetricCard`로 표시합니다. `metricProjection`은 일별 값과 부분 상태를 소유합니다. 화면 이전은 #699가 담당합니다.
- 건강 기록의 `HealthRecordsCategoryCard`는 `HealthRecordsCategoryCharts`를 통해 혈압, 심박수, 걸음, 체중 차트를 표시합니다. `healthRecordsChartModel`은 관측값을 계열로 분류하고, `HealthRecordsCategoryCharts`는 단위별 차트를 분리합니다. 화면 이전은 #700이 담당합니다.
- 상세 기록은 목록과 기간 선택을 제공하며 현재 차트가 없습니다. 녹음 파형, 진행 표시, 일정과 사건 중심 요약은 통계 차트 이전 범위가 아닙니다.

## 후보와 현재 제한

첫 후보는 MIT 라이선스의 `react-native-chart-kit` 7.0.4 `/v2`와 `react-native-svg` 15.16.1입니다. Chart Kit의 peer 범위는 React 19.2.3과 React Native 0.87.1을 포함합니다. SVG의 명시 범위만으로 호환성을 확정하지 않으며, 실제 새 아키텍처 컴파일과 Simulator 화면을 별도로 확인합니다. [Chart Kit 패키지](https://registry.npmjs.org/react-native-chart-kit/7.0.4), [SVG 호환성](https://github.com/software-mansion/react-native-svg#supported-react-native-versions)을 참조하세요.

Chart Kit은 모든 계열을 공통 행으로 정규화하므로 다른 계열의 시각에서 빠진 값과 명시적 null이 같아집니다. 시제품은 명시적 null에서 계열을 구간으로 나누고 구간 내의 다른 시각을 건너뜁니다. 실제 숫자를 보간하거나 새 측정값을 만들지 않습니다. 표시용 범례와 값 목록은 구간이 아닌 원래 계열을 사용합니다.

[Gifted Charts 1.4.81](https://registry.npmjs.org/react-native-gifted-charts/1.4.81)은 독립 데이터 배열과 숫자 x 값을 제공하지만 peer 범위가 wildcard이며, 결측 보간이 기본으로 켜져 있어 명시적으로 꺼야 합니다. 해당 조합의 네이티브 실행은 아직 확인하지 않았습니다. [Victory Native 43.0.1](https://registry.npmjs.org/victory-native/43.0.1)은 명시적 React 및 React Native 범위를 제공하지만 Skia, Reanimated, Worklets와 Gesture Handler를 추가로 요구합니다. 어느 후보도 선언된 peer 범위만으로 호환성을 입증하지 않습니다.

현재 `ChartPlot`은 입력 계열과 단위, 요청 및 표시 범위, 원본과 부분 상태를 받습니다. 시간축은 실제 시각을, 막대는 일별 범주를 사용합니다. 권한이 없어진 상태에서는 이전 값을 숨기고, 로딩 중에는 전달받은 유효 값을 유지합니다. 공용 형식은 일별 날짜를 시간대 변환 없이 표시하고 측정값을 임의로 반올림하지 않습니다. 상태, 부분 기록, 출처와 측정되지 않은 값을 공통 문구로 표시합니다. 계열에는 순서가 바뀌어도 유지되는 실선 또는 점선 역할을 지정합니다. 그래프 조작을 요구하지 않는 값 목록을 제공합니다. 큰 글자에서 축과 그래프가 겹치는 것을 피하기 위해 그래프 대신 값 목록을 표시합니다.

## 소비 화면 계약

#699와 #700은 `src/ui/charts`의 `ChartPlot`과 `ChartData`를 사용합니다. `kind`는 `line` 또는 `bar`이며, 화면은 안전 영역과 자체 여백을 제외한 실제 콘텐츠 폭과 높이를 전달합니다. 제목, 계열명, 요청·표시 범위와 출처는 화면이 소유하고 사용자에게 보이는 앱 문구는 타입이 있는 `t()` 키를 통해 준비합니다. 공용 상태·단위·페이지 문구는 차트가 번역합니다.

선 계열의 `x`는 실제 ISO 시각이고 막대의 `x`는 `YYYY-MM-DD` 날짜입니다. 같은 그래프에는 같은 단위와 고유 계열 ID를 사용하며, `null`은 미측정이고 0은 실제 값입니다. 화면은 권한 취소나 삭제를 데이터에 반영하고, 차트는 데이터를 다시 조회하거나 단위를 합치지 않습니다. 사용자는 페이지 버튼과 값 목록에서 원본 측정값과 출처를 확인할 수 있습니다.

렌더링은 관측값 최대 100개를 한 페이지에 표시합니다. 일반적으로 같은 시각의 관측값을 함께 유지하며, 한 시각에 100개를 초과하면 그 묶음도 나눕니다. 모든 관측값과 극값은 이전·다음 버튼으로 접근하며 자동 축약하지 않습니다. 페이지 번호와 현재 페이지의 시작·끝 시각은 요청 및 실제 수집 범위와 별도로 표시합니다. 이 제한의 실제 기기 성능과 메모리 비용은 별도 실행 증거가 필요합니다.

2026-11-10에 같은 레지스트리에서 `pnpm audit --prod --json`으로 기준 커밋 `8baee913b70260ed4dbe578805c57b8d5730f9b6`의 잠금 파일과 이 PR의 잠금 파일을 각각 조회했습니다. 두 결과 모두 동일한 advisory 8개(높음 4, 보통 3, 낮음 1)를 보고했습니다. 차트 패키지를 경유하는 advisory 경로는 모두 기존 React Native peer를 거칩니다. 이는 새 advisory ID가 없었다는 해당 시점의 결과이며, 위험이 없다는 보증은 아닙니다. 원본 JSON은 `/tmp/orot-chart-audit-baseline.json`과 `/tmp/orot-chart-audit-current.json`에 보존합니다. Chart Kit의 직접 의존성 `paths-js` 0.4.11은 Apache-2.0이고, SVG의 직접 의존성 `css-select` 5.2.2는 BSD-2-Clause, `css-tree` 1.1.3은 MIT입니다. 각 패키지에 포함된 라이선스 원문을 유지합니다.

Simulator의 합성 자료로 VoiceOver가 측정값과 출처를 발화하고 세 페이지의 마지막 극값에 도달하는 테스트는 통과했습니다. 이는 단일 실행 결과이며 실제 기기 성능이나 나머지 접근성 조건을 증명하지 않습니다.

깨끗한 iOS 테스트 빌드에서는 SVG 15.16.1의 경고 60개가 저장소의 경고 검사에 걸렸습니다. 같은 앱에서 15.15.4를 비교했을 때도 경고 60개가 발생했고, 해당 버전의 Pod 최소 배포 대상 오류로 빌드가 실패했습니다. 경고를 무시하거나 검사 기준을 완화하지 않았습니다. Gifted Charts도 SVG peer를 요구하므로 차트 라이브러리만 바꿔서는 이 문제를 제거하지 못합니다. Victory와 Skia는 별도의 네이티브 의존성과 설정 및 재검증이 필요합니다.

현재는 `react-native-svg` 15.16.1에 저장소 소유 패치를 적용합니다. Fabric의 구체적인 Props 타입은 Objective-C 클래스 상속과 달리 서로 다른 타입이므로, 공통 View 속성을 이전 값과 비교한 다음 일치하는 SVG 타입만 처리합니다. 가변 길이 스택 배열은 크기가 같은 벡터로 바꾸고 빈 입력을 명시적으로 처리합니다. 2026-11-10 기준 [공식 최신 릴리스](https://github.com/software-mansion/react-native-svg/releases/tag/v15.16.1)에 이 변경은 포함되지 않았습니다. 다음 버전을 검토할 때 패치를 재평가하고 upstream 수정이 해당 동작과 검증을 대체하면 제거해야 합니다. 이 패치는 [upstream의 속성 제거 관련 이슈](https://github.com/software-mansion/react-native-svg/issues/3081) 전체를 해결한다고 주장하지 않습니다.

Victory 비교에는 Victory Native 43.0.1, Skia 2.15.4, Reanimated 4.7.1, Worklets 0.13.1, Gesture Handler 3.5.0을 사용했습니다. 이 패키지들은 각각 MIT 라이선스이며, 선언된 peer 범위에서 Reanimated와 Worklets는 React Native 0.87을 포함합니다. [공식 설치 문서](https://nearform.com/open-source/victory-native/docs/getting-started)는 Skia 2.x와 Worklets Babel 플러그인을 요구합니다. 기존 의존성을 유지한 채 대안을 추가한 잠금 파일 비교에서는 377줄이 추가됐고 Skia는 플랫폼별 네이티브 패키지도 가져옵니다.

기존 SVG와 Chart Kit을 제거하고 합성 선 차트만 번들에 넣은 깨끗한 iOS Simulator 빌드에서 Xcode는 성공했지만 경고 검사에 200건이 걸렸습니다. Skia 헤더의 문서 경고, Gesture Handler의 미사용 함수, Reanimated의 정수 변환 등입니다. 경고 검사 통과 전이므로 Simulator 화면을 확인하지 않았으며, 이는 차트 계약이나 실제 접근성을 검증한 결과가 아닙니다. 대안 구현에서는 공용 데이터 계약, 서식, 페이지 정책과 값 목록을 재사용할 수 있지만 렌더러와 네이티브 검증은 교체해야 합니다.

패치 적용 후 깨끗한 iOS 테스트 빌드는 경고 0건으로 통과했습니다. 같은 Simulator에서 차트 VoiceOver 테스트는 처음에 발화 서비스 오류로 실패했고, 기존 내비게이션 VoiceOver 대조군이 통과한 뒤 한 번 재실행해 발화와 페이지 이동을 확인했습니다. SVG 도형의 갱신·터치·복원과 같은 네이티브 텍스트 객체의 초기화·재사용도 별도로 확인했습니다.

추가 Simulator 진단에서는 320pt 콘텐츠 영역과 874pt 가로 화면에서 제목·상태·범위의 프레임이 겹치지 않았고, 안전 영역을 제외한 폭으로 그래프 양 끝과 축을 확인했습니다. 시스템의 동작 줄이기를 켠 상태에서도 차트와 페이지 이동이 동작했습니다. 201개 합성 관측을 최대 100개씩 표시할 때 한 번의 페이지 이동은 약 0.52초였고, XCTest는 해당 측정의 물리 메모리 변화 약 3.4MB와 최대 약 75.5MB를 보고했습니다. 이는 단일 Simulator 측정으로 실제 기기 성능 예산이나 반복 안정성을 증명하지 않습니다.

실제 기기의 조밀한 자료 성능과 메모리 및 나머지 네이티브 접근성 조건은 검증되지 않았습니다. 두 화면 이전과 최종 통합 검증은 각각의 후속 이슈가 담당하며, 기존 차트도 그 범위에서 제거합니다.
