# 오롯: 기록을 모아, 다음 진료를 준비합니다

![실제 오롯 AI 도우미 화면을 바탕으로 만든 앱 소개 이미지](docs/assets/orot-hero.png)

_소개용 합성 이미지입니다. 원본 화면과 촬영 환경은 [스크린샷 출처](docs/assets/screenshot-provenance.md)에서 확인할 수 있습니다._

[![Code Quality](https://github.com/eunsoogi/orot/actions/workflows/code-quality.yml/badge.svg?branch=main)](https://github.com/eunsoogi/orot/actions/workflows/code-quality.yml)
[![iOS 15.1+](https://img.shields.io/badge/iOS-15.1%2B-000000)](apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj)
[![React Native 0.87.1](https://img.shields.io/badge/React%20Native-0.87.1-61DAFB)](apps/mobile/package.json)
[![LangChain 1.2.14](https://img.shields.io/badge/LangChain-1.2.14-1C3C3C)](packages/agent-runtime/package.json)
[![LangGraph 1.4.18](https://img.shields.io/badge/LangGraph-1.4.18-1C3C3C)](packages/agent-runtime/package.json)

오롯은 상담 녹음, 사용자가 선택한 건강 기록, 진료 일정을 아이폰에 정리하고 다음 진료에서 나눌 내용을 준비하는 개인 건강 기록 앱입니다. 기록의 출처와 시점을 살펴 필요한 맥락을 찾을 수 있습니다.

## 오롯에서 할 수 있는 일

- 참여자 안내와 동의 뒤 상담을 녹음하고, 전사는 따로 요청해 기기 안에서 처리합니다.
- HealthKit에서 필요한 건강 관찰을 선택해 가져오고, 진료 일정은 직접 등록하거나 캘린더 후보를 확인해 저장합니다.
- 다음 진료 질문, 질환 가능성 가설, 기록 기반 대화, 외부 의학 자료 검색을 각각의 AI 기능에서 이용합니다.
- AI가 참고한 기록과 출처를 확인하고, 질문을 검토해 진료 일정에 연결할 수 있습니다.

## 기술을 직접 구현하며 배운 것

LangChain, LangGraph, RAG를 이름만 공부하는 데서 그치지 않고, 실제 iOS 앱의 기록 흐름에 연결해 직접 구현하며 배우고 싶었습니다. 각 기술이 어떤 문제를 맡는지 구분해 설계했습니다.

- **LangChain**은 허용된 로컬 기록을 읽고 검토된 기억을 다루는 도구 인터페이스를 제공합니다. 도구는 호출자가 정한 범위 안에서만 실행됩니다.
- **LangGraph**는 응답과 근거 조사를 단계로 나누고, 실행 설정·도구 범위·예산·출처를 확인하는 워크플로를 구성합니다.
- **RAG**는 기기 안의 E5 임베딩과 SQLCipher 벡터 저장, FTS5 키워드 검색을 결합합니다. 호출자가 출처를 연결해 전달한 검색 조각만 사용하며 모든 기록을 자동으로 색인하지 않습니다.

## 기록과 동의

앱 기록은 SQLCipher로 암호화해 기기에 저장하며 건강 기록을 보관하는 오롯 서버는 없습니다. 외부 모델을 사용하는 요청은 전송 내용과 수신자를 확인한 뒤 별도로 동의해야 합니다. 외부 문헌 검색도 검색어 전송에 대한 동의가 따로 필요합니다. AI 응답은 의료진의 진단을 대신하지 않습니다.

## 더 알아보기

[상세 아키텍처와 데이터 흐름](docs/architecture.md) · [개발 환경과 실행 방법](docs/development.md) · [코드 품질 검사](docs/code-quality.md)
