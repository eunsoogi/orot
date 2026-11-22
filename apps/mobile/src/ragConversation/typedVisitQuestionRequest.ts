// Match explicit Korean requests to create a visit-question list, not merely
// text mentioning a visit or asking a medical question. Recognition never edits
// the authored prompt and grants no appointment or disclosure authority.
const visit = String.raw`(?:(?:다음|이번|다가오는)\s*)?(?:진료|외래|진찰)(?:\s*(?:때|에서|에|전|용))?\s*`;
const question = String.raw`(?:(?:의사(?:\s*선생님)?|선생님)(?:께|에게)\s*)?(?:(?:물어\s*볼|여쭤\s*볼|할|드릴)\s*)?질문(?:\s*(?:목록|리스트|들))?(?:을|를)?\s*`;
const focus = String.raw`[가-힣A-Za-z0-9\s·()]{1,80}(?:위주로|중심으로|관련해서|바탕으로)`;
const count = String.raw`(?:\d{1,2}\s*(?:개|가지)\s*)?`;
const create = String.raw`(?:만들어|준비해|작성해|생성해|정리해|추천해)\s*(?:줘(?:요)?|주세요|주실래요|주실\s*수\s*있나요|줄\s*수\s*있나요)?`;
const request = new RegExp(
  String.raw`^(?:${focus}\s+)?${visit}${question}(?:${focus}\s+)?${count}${create}(?:[.!?]\s*${focus})?[.!?]?$`,
  'u',
);

// A standalone command may refer to an upcoming visit named in an immediately
// preceding statement. Do not borrow intent from a previous conversation turn.
const followUpRequest = new RegExp(
  String.raw`^(?:다음|이번|다가오는)\s*(?:진료|외래|진찰)[가-힣A-Za-z0-9\s·()]{1,84}(?:예정이에요|예정입니다|있어요|있습니다|가요|갑니다|봐요|봅니다|받아요|받습니다)[.!]\s*${question}(?:${focus}\s+)?${count}${create}[.!?]?$`,
  'u',
);

export function isTypedVisitQuestionRequest(text: string): boolean {
  const value = text.trim().normalize('NFC');
  return (
    value.length <= 180 &&
    !/말고|말아|않|아니라|대신/u.test(value) &&
    (request.test(value) || followUpRequest.test(value))
  );
}
