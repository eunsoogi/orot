/** Evidence-led actions never infer attendance, adherence, or a cause from proximity. */
export const dailyReportActionsKo = {
  'dailyReport.medication.namedAction': '{names} 관련 기록: {text}',
  'dailyReport.medication.identity':
    '복약 기록에 연결된 약 이름: {name}.',
  'dailyReport.context.appointmentCoverage':
    '앱에 확정해 저장한 진료 일정만 포함해요. 전체 캘린더의 일정과 참석 여부는 확인하지 않았어요.',
  'dailyReport.context.appointmentSource': '저장한 진료 일정',
  'dailyReport.context.appointmentFact': '진료 일정: {status}',
  'dailyReport.context.appointment.scheduled': '예정',
  'dailyReport.context.appointment.rescheduled': '변경된 일정',
  'dailyReport.context.appointment.completed': '완료로 기록됨',
  'dailyReport.context.appointment.cancelled': '취소됨',
  'dailyReport.context.doseMissed':
    '복약에서 우선 확인할 점이 있어요. 오늘 누락 또는 건너뜀으로 남긴 기록이 있어요. 약마다 대처가 다르므로 해당 약의 설명서나 처방 지침을 확인하고 불확실하면 약사·의료진에게 상담하세요. 임의로 보충 복용하거나 용량을 변경하지 마세요. (NHS SPS 복용 누락 안내)',
  'dailyReport.context.doseTaken':
    '오늘 기록된 회차의 복용·투여를 완료했어요. 다른 예정 회차의 복용 여부와는 구분해요.',
  'dailyReport.context.doseUnknown':
    '오늘 복약 알림·미기록 등 복용 여부가 확정되지 않은 상태가 있어요. 이를 누락이나 복용 완료로 바꾸어 판단하지 않았어요. 중복 복용을 피하도록 기존 복약 기록과 처방 지침을 기준으로 관리하세요.',
  'dailyReport.context.visitSymptoms':
    '오늘 진료 일정 기록과 지속 중으로 남은 증상 기록을 함께 확인했어요. 진료 시 증상 경과와 측정 기록을 함께 보여 주면 상담에 도움이 돼요. 일정만으로 실제 진료를 받았다고 판단하거나 진료 때까지 증상을 기다리라고 권하지 않아요.',
  'dailyReport.context.visitMedication':
    '오늘 진료 일정과 복약 기록이 함께 있어요. 상담 시 실제 복용한 약과 누락·불확실한 회차를 함께 전달하세요. 일정이 있다는 이유만으로 진료 완료나 처방 변경을 추정하지 않았어요.',
  'dailyReport.context.visitOnly':
    '오늘 확정해 저장한 진료 일정이 있어요. 일정의 기록 상태와 실제 방문 여부는 다를 수 있어요. 원래 안내받은 예약·준비 사항을 확인하세요.',
  'dailyReport.context.visitCompleted':
    '오늘 완료로 저장한 진료 일정이 있어요. 진료 후 안내받은 관리 계획을 따르되, 이 일정 자체에는 진단이나 새 처방 내용이 확인되지 않아 임의로 추가하지 않았어요.',
  'dailyReport.context.coverage':
    '이 보고서는 현재 접근 가능한 당일 기록을 먼저 종합했어요. 전체 건강을 정상 또는 이상으로 단정하지 않으며, 미측정·동기화 미확인·누락된 자료는 정상으로 채우지 않았어요. 전체 캘린더가 아니라 앱에 확정해 저장한 일정만 포함하며, 예정 일정은 실제 방문과 구분하며 개인별 과거 기준은 이 입력 범위에 포함되지 않아요.',
} as const;
