// These labels translate app-owned copy while keeping persisted symptom states unchanged.
export const symptomJournalKo = {
  'symptoms.journal.provenance':
    '직접 입력한 기록이며 의료진이 확인한 정보는 아니에요.',
  'symptoms.journal.status.active': '계속되고 있어요',
  'symptoms.journal.status.resolved': '나아졌어요',
  'symptoms.journal.statusFilter.title': '상태로 필터링',
  'symptoms.journal.statusFilter.all': '전체',
  'symptoms.journal.dateFilter.title': '시작 시각으로 필터링',
  'symptoms.journal.dateFilter.startDate': '시작 날짜',
  'symptoms.journal.dateFilter.startTime': '시작 시각',
  'symptoms.journal.dateFilter.endDate': '끝 날짜',
  'symptoms.journal.dateFilter.endTime': '끝 시각',
  'symptoms.journal.dateFilter.guidance':
    '기기 현지 시각 기준으로 시작과 끝을 모두 포함해요.',
  'symptoms.journal.dateFilter.invalid':
    '기간의 각 경계에 올바른 날짜와 시각을 입력해 주세요.',
  'symptoms.journal.dateFilter.order': '끝 시각은 시작 시각 이후여야 해요.',
  'symptoms.journal.dateFilter.apply': '기간 적용',
  'symptoms.journal.dateFilter.clear': '기간 지우기',
  'symptoms.journal.filterError':
    '증상 기록을 필터링하지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.localDateTime': '{dateTime} (현지 시각)',
  'symptoms.journal.startedAt': '시작한 시각: {dateTime}',
  'symptoms.journal.resolvedAt': '나아진 시각: {dateTime}',
  'symptoms.journal.severity': '내가 느낀 불편 정도: {severity}/10',
  'symptoms.journal.selectEntry': '증상 기록 선택: {description}',
  'symptoms.journal.selectedEntry': '선택한 증상 기록: {description}',
  'symptoms.journal.selectEntryHint': '이 기록을 선택해 요약을 확인해요.',
  'symptoms.journal.selection.title': '선택한 증상',
  'symptoms.journal.selection.empty':
    '목록에서 증상 기록을 선택하면 요약을 볼 수 있어요.',
  'symptoms.journal.back': '뒤로',
  'symptoms.journal.retry': '다시 시도',
  'symptoms.journal.loading': '증상 기록을 불러오는 중…',
  'symptoms.journal.empty': '이 조건에 맞는 증상 기록이 없어요.',
  'symptoms.journal.add': '증상 기록 추가',
  'symptoms.journal.edit': '증상 기록 수정',
  'symptoms.journal.markResolved': '나아진 것으로 표시',
  'symptoms.journal.loadError':
    '증상 기록을 불러오지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.openError':
    '증상 일지를 열지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.resolveError':
    '증상 상태를 변경하지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.form.newTitle': '증상 기록 추가',
  'symptoms.journal.form.editTitle': '증상 기록 수정',
  'symptoms.journal.form.description.label': '증상 내용',
  'symptoms.journal.form.description.placeholder': '어떤 느낌인지 적어 주세요.',
  'symptoms.journal.form.onset.title': '시작한 때 (기기 현지 시각)',
  'symptoms.journal.form.onset.date': '증상 시작 날짜',
  'symptoms.journal.form.onset.time': '증상 시작 시각',
  'symptoms.journal.form.status.title': '증상 상태',
  'symptoms.journal.form.resolved.title': '나아진 때 (기기 현지 시각)',
  'symptoms.journal.form.resolved.date': '나아진 날짜',
  'symptoms.journal.form.resolved.time': '나아진 시각',
  'symptoms.journal.form.bodySite.label': '증상이 있는 부위 (선택)',
  'symptoms.journal.form.bodySite.placeholder': '신체 부위 (선택)',
  'symptoms.journal.form.severity.label': '불편 정도, 0에서 10까지 (선택)',
  'symptoms.journal.form.severity.placeholder': '불편 정도 (선택, 0–10)',
  'symptoms.journal.form.severity.hint':
    '불편 정도는 선택 입력이며 직접 기록해요.',
  'symptoms.journal.form.validation.description': '증상 내용을 입력해 주세요.',
  'symptoms.journal.form.validation.severity':
    '불편 정도는 0부터 10까지 정수로 입력해 주세요.',
  'symptoms.journal.form.validation.onset':
    '증상 시작 날짜와 시각을 올바르게 입력해 주세요.',
  'symptoms.journal.form.validation.status': '증상 상태를 선택해 주세요.',
  'symptoms.journal.form.validation.resolved':
    '나아진 날짜와 시각을 올바르게 입력해 주세요.',
  'symptoms.journal.form.updateError':
    '증상 기록을 수정하지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.form.saveError':
    '증상 기록을 저장하지 못했어요. 다시 시도해 주세요.',
  'symptoms.journal.form.saving': '저장 중…',
  'symptoms.journal.form.saveChanges': '변경 사항 저장',
  'symptoms.journal.form.save': '증상 기록 저장',
  'symptoms.journal.form.close': '닫기',
  'symptoms.journal.keyboard.done': '완료',
} as const;
