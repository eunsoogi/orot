# 일일 보고서 해석 경계

2026-11-15 공개 원문을 확인했다. 사용자 기록이나 화면은 이 문서와 테스트에 포함하지 않는다.

## 현재 지원하는 해석

`dailyReportGuidance`는 모델이 작성한 진단 대신, 검증된 원본 기록에 연결된 제한적 교육 안내를 생성한다. 혈압은 mmHg의 개별 측정을 사용하며 커프 측정의 수 초 구간도 포함한다. 다른 기기/시각의 수축기·이완기 값을 한 쌍으로 만들지 않는다. 수치가 정상 범위처럼 보여도 전체 건강이 정상이라고 판정하지 않는다. 연령, 임신, 개인 목표, 측정 장소는 확인되지 않았으므로 성인 참고 기준의 적용 한계를 명시한다.

- [질병관리청 고혈압 안내](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=6765): 진료실 기준과 가정혈압 기준은 다르다. 가정혈압 135/85 기준은 반복 측정 평가의 참고 기준이며 단일값 진단에 사용하지 않는다. 염분 감소, 금연·절주 등의 생활 안내와 임의 약물 변경 금지를 포함한다. [가정혈압 기준 원문](https://health.kdca.go.kr/healthinfo/biz/health/ntcnInfo/healthSourc/thtimtCntnts/thtimtCntntsView.do?thtimt_cntnts_sn=28)을 함께 확인한다. 세부 개인 치료 목표를 구현하지 않았다.
- [AHA 가정혈압 안내](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home): 단일 높은 값은 재측정한다. 매우 높은 값과 흉통·숨참·신경학적 증상은 즉시 응급 연락 대상이며 증상 동반 시 재측정을 기다리도록 하지 않는다. AHA 원문은 180/120 초과라고 표기한다. 국내 안내의 180/120 이상 경계에 맞춰 경계값도 보수적 확인 대상으로 삼으며 이를 AHA의 정확한 경계라고 표현하지 않는다. 기록이 과거일 수 있으므로 현재 응급상태로 단정하지 않는다. 원본 값이 충돌해도 심한 값은 확인 안내에서 숨기지 않는다.
- [WHO 신체활동](https://www.who.int/news-room/fact-sheets/detail/physical-activity): 활동은 개인 능력과 상태에 맞춰 안내한다. 일부 걸음/운동 샘플로 하루 총량이나 운동 부족을 단정하지 않는다.
- [Apple HealthKit 권한](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data): 앱은 읽기 권한 거부를 알 수 없고 접근 가능한 기간도 제한될 수 있다. 운동 기록 부재는 실제 운동을 안 했다는 증거가 아니다.

## 보존과 한계

기존 저장 보고서는 생성 당시 원문을 보존한다. 원시 기록 목록은 기본 접힘으로 두되 사용자가 펼치고 출처로 이동할 수 있다. 새 보고서의 표시용 수치/항목/시각만 지역화하며 모델에 전달하는 원본 값은 변경하지 않는다.

이번 단계는 혈압과 활동 안내, 기존 패턴 요약 및 표시 개선이다. 전체 건강의 임상적 진단, 모든 측정 항목의 정상/이상 판단, 과거 기준과 생활 맥락을 종합하는 모델 품질은 입증하지 않았다. 이 한계를 이유로 데이터 없는 항목을 정상 또는 운동 부족으로 채우지 않는다. 원본 저장·동의·긴급 안전 경계는 유지한다. 합성 테스트만 사용하며 실제 모델·실기기 검증을 주장하지 않는다.
