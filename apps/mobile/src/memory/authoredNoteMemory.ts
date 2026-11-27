import {
  declinesStatementRetention,
  isSafeStatement,
} from './userStatementMemory';

// A terminal nomination determines usefulness, not authority to write from any
// source. Require one whole current utterance, with no omitted qualifier or text.
export function isWholeStandingAuthoredNote(
  question: string,
  statement: unknown,
): statement is string {
  return (
    typeof statement === 'string' &&
    statement === question &&
    statement === statement.trim() &&
    statement.length >= 8 &&
    statement.length <= 900 &&
    !/[\r\n\t:：;；#@'‘’«‹\p{N}\p{Cf}]/u.test(statement) &&
    !/[.!。]\s*\S/u.test(statement) &&
    !declinesStatementRetention(statement) &&
    // Exclude common health and identity language without defining positive
    // topic categories. This text fence is not a general sensitive-data detector.
    !/건강|진료|증상|수술|병원|질병|암(?=$|[\s은는이가을를에])|종양|장애|우울증|고혈압|당뇨|진단|치료|복용|약물|처방|혈압|심박|주민\s*등록|전화\s*번호|주소|계좌|결제|신용\s*카드|회사\s*기밀|\b(?:medical|health|diagnos\w*|syndrome|medicine|medication|prescri\w*|surgery|patient|cancer|disease|illness|hospital|symptom\w*|therapy|disorder|diabetes|bipolar|depression|address|ssn|passport|bank|credit\s*card|phone\s*number)\b/iu.test(
      statement,
    ) &&
    isSafeStatement(statement) &&
    // Nomination is not enough to infer authorship from a pasted fragment,
    // named third-person subject, or the model's interpretation of a title.
    /^(?:저는\s|제가\s|나는\s|내가\s|제\s|내\s|I\s|My\s)/iu.test(statement)
  );
}
