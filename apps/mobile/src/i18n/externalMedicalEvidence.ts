/** Korean catalog entries for user-consented external literature search. */
export const externalMedicalEvidenceKo = {
  'externalMedicalEvidence.title': '외부 의료 자료',
  'externalMedicalEvidence.description':
    '검색을 누르면 입력한 검색어만 Europe PMC로 전송돼요. 앱의 건강 기록은 보내지 않아요. 문헌은 개인 기록과 별개의 참고 자료예요.',
  'externalMedicalEvidence.placeholder': '예: 수면과 혈압의 관계',
  'externalMedicalEvidence.search': '검색어 보내고 자료 찾기',
  'externalMedicalEvidence.loading': '외부 문헌을 찾고 있어요.',
  'externalMedicalEvidence.selectResult':
    '검색한 문헌을 선택하면 원문 정보와 출처를 확인할 수 있어요.',
  'externalMedicalEvidence.consent':
    '검색어를 Europe PMC에 전송하는 데 동의해요.',
  'externalMedicalEvidence.consentRequired':
    '검색어 전송에 동의한 뒤 검색할 수 있어요.',
  'externalMedicalEvidence.empty': '검색 결과가 없어요.',
  'externalMedicalEvidence.unavailable':
    '외부 자료를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  'externalMedicalEvidence.publicationDate': '처음 공개된 날짜: {date}',
  'externalMedicalEvidence.updatedDate': '자료 수정 날짜: {date}',
  'externalMedicalEvidence.unknownDate': '확인할 수 없어요.',
  'externalMedicalEvidence.retrievedAt': '가져온 시각: {time}',
  'externalMedicalEvidence.source': '출처: {provider}',
  'externalMedicalEvidence.open': '원문 열기',
  'externalMedicalEvidence.authorUnknown': '저자 정보를 확인할 수 없어요.',
  'externalMedicalEvidence.literature.population.adults': '성인',
  'externalMedicalEvidence.literature.population.children': '아동',
  'externalMedicalEvidence.literature.population.adolescents': '청소년',
  'externalMedicalEvidence.literature.population.olderAdults': '고령자',
  'externalMedicalEvidence.literature.exposure.sleep': '수면',
  'externalMedicalEvidence.literature.exposure.shortSleep': '짧은 수면',
  'externalMedicalEvidence.literature.exposure.shortSleepDuration':
    '짧은 수면 시간',
  'externalMedicalEvidence.literature.exposure.physicalActivity': '신체 활동',
  'externalMedicalEvidence.literature.exposure.sedentaryBehavior': '좌식 행동',
  'externalMedicalEvidence.literature.exposure.smoking': '흡연',
  'externalMedicalEvidence.literature.outcome.obesity': '비만',
  'externalMedicalEvidence.literature.outcome.bloodPressure': '혈압',
  'externalMedicalEvidence.literature.outcome.sleepQuality': '수면의 질',
  'externalMedicalEvidence.literature.outcome.depressiveSymptoms': '우울 증상',
  'externalMedicalEvidence.literature.outcome.healthOutcomes': '건강 결과',
  'externalMedicalEvidence.literature.qualitativeSummary':
    '초록은 연구 대상이 {person}이라고 설명해요. 선택한 초록 문장에는 {exposure}과 {outcome}의 연관성이 서술되어 있어요.',
  'externalMedicalEvidence.literature.statistic.oddsRatio': '오즈비',
  'externalMedicalEvidence.literature.statistic.riskRatio': '위험비',
  'externalMedicalEvidence.literature.statistic.hazardRatio': '위험률비',
  'externalMedicalEvidence.literature.statisticLine':
    '{label} {value} ({confidenceLevel}% 신뢰구간 {confidenceInterval})',
  'externalMedicalEvidence.literature.selectedSentence':
    '초록에서 선택한 문장: {span}',
  'externalMedicalEvidence.literature.statisticsHeading':
    '초록의 수치 표기: {statistics}',
  'externalMedicalEvidence.literature.statisticsOutcomeUnknown':
    '이 수치가 관찰 결과인지 확인하지 못했어요.',
  'externalMedicalEvidence.literature.sentenceRolesAndOutcomeUnknown':
    '선택한 문장의 역할과 이 수치가 관찰 결과인지 확인하지 못했어요.',
  'externalMedicalEvidence.literature.sentenceMeaningUnknown':
    '선택한 문장의 의미를 충분히 확인하지 못했어요.',
  'externalMedicalEvidence.literature.relevanceAndLimitsUnknown':
    '질문과의 관련성 및 연구의 한계는 충분히 확인하지 못했어요. 원문 전체와 출판 상태는 확인하지 못했어요.',
  'externalMedicalEvidence.source.literatureFallbackTitle': 'Europe PMC 문헌',
  'externalMedicalEvidence.source.provenance': 'Europe PMC · 공개 의학 문헌',
  'externalMedicalEvidence.source.providerCompact': 'Europe PMC',
  'externalMedicalEvidence.source.retrievedAtInline': ' · 조회 {date}',
  'externalMedicalEvidence.source.openHint': '문헌 원문 열기',
  'externalMedicalEvidence.answer.publicWebDisclaimer':
    '공개 웹자료를 바탕으로 AI가 정리한 설명을 참고했어요. 함께 표시된 출처에서 원문을 확인할 수 있어요.',
  'externalMedicalEvidence.answer.publicLiteratureDisclaimer':
    '공개 의학 문헌의 일부 검색 결과를 참고했어요. 개인의 진단이나 전체 문헌 검토를 대신하지 않아요.',
} as const;
