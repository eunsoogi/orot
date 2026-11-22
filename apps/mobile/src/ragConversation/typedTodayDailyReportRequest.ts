import { t } from '../i18n';

// The undated explicit creation command means the current local day only.
// Date-bearing, historic or mixed questions must not acquire today's target.
const request =
  /^(?:오늘(?:의)?\s*(?:일일\s*)?보고서|일일\s*보고서)(?:를|을)?\s*(?:만들어|작성해|생성해|준비해|요청해|부탁해)\s*(?:줘(?:요)?|주세요|주실래요|줄\s*수\s*있나요)?[.!?]?$/u;

export function isTypedTodayDailyReportRequest(question: string) {
  const value = question.normalize('NFC').trim();
  return (
    value.length <= 80 &&
    (value === t('dailyReport.title') ||
      value === t('dailyReport.openFromChat') ||
      request.test(value))
  );
}
