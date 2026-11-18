# Apple Private Cloud Compute

오롯은 기기 내 Apple Intelligence와 Apple Private Cloud Compute(PCC)를 별도 제공자·모델로 구분합니다. PCC는 원격 처리이므로 선택한 기록과 질문의 수신자를 Apple PCC로 표시하고 기존 원격 전송 동의와 기록 검증을 적용합니다. 계정 오류나 PCC 사용 불가 시 다른 모델로 자동 전환하지 않습니다. 기존 온디바이스 Recap 변환 경로는 변경하지 않습니다.

## 배포 조건

PCC API는 iOS 27 이상에서 사용할 수 있습니다. Apple은 App Store Small Business Program 가입, 200만 회 미만의 최초 다운로드, managed entitlement 승인을 요구합니다. 실제 배포 팀의 승인 여부는 이 저장소에서 확인하거나 신청하지 않습니다.

기본 빌드는 `OROT_PCC_ENABLED` Swift 조건을 설정하지 않아 PCC 선택을 비활성화합니다. 승인된 팀과 프로비저닝을 준비한 뒤에만 별도의 배포 설정에서 이 조건 및 Apple의 `com.apple.developer.private-cloud-compute` entitlement를 설정해야 합니다. 조건만 켠 것은 승인 증명이 아니며, 이후에도 Foundation Models의 OS availability와 quota 검사를 통과해야 합니다. 다른 앱 권한이나 서명 기본값을 변경해서 이를 우회하면 안 됩니다.

PCC의 일일 한도는 Apple이 사용자 iCloud 계정별로 관리합니다. 앱이 별도 도구 호출·바이트 예산을 추가하지 않습니다. 한도 도달 시 선택을 비활성화하고 오류를 보존하며, 네트워크·서비스 오류에도 다른 제공자로 데이터를 보내지 않습니다. 현재 구현은 기본 reasoning 설정을 사용하고 이미지 입력을 지원한다고 선언하지 않습니다.

## 검증 경계

단위 테스트는 선택 정체성, 원격 수신자·동의, 비활성 상태와 전송 차단을 synthetic 입력으로 검사합니다. 네이티브 회귀는 모델 간 tool continuation 차단과 기본 빌드의 fail-closed admission을 검사합니다. 이 결과는 PCC 서버 추론 성공이나 계정 entitlement 승인을 뜻하지 않습니다. 실제 서버 추론은 승인된 배포와 별도 허가된 synthetic 테스트 환경에서 확인해야 합니다.

## 공식 자료

- [PCC 접근 자격](https://developer.apple.com/private-cloud-compute/)
- [Foundation Models PCC 통합](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute)
- [WWDC26 PCC 세션](https://developer.apple.com/videos/play/wwdc2026/319/)
