import { isEligibleConversationMemorySource } from '../manualHistory/conversationHistoryIntent';
import type { AgentMemoryInput } from '@orot/agent-memory';
import type { ConversationArtifact } from '../storage/conversationArtifactTypes';
import type { ManualHistoryEntry } from '@orot/domain';

/** Recognize only a single authored statement, not an open-ended memory command. */
function statementFromExplicitRequest(text: string): string | undefined {
  const authored =
    /^(?:please\s+)?remember that\s+(.+)$/i.exec(text)?.[1] ??
    /^기억해\s*(?:주세요|줘)\s*:\s*(.+)$/.exec(text)?.[1] ??
    /^(.+[.!。])\s+기억해\s*(?:주세요|줘)[.!。]?$/.exec(text)?.[1];
  if (!authored || /[.!。](?=\s*\S)/.test(authored.trim())) return undefined;
  return authored.trim();
}

/** Shared admission excludes quoted, hypothetical, third-party, private and opted-out claims. */
function isSafeStatement(text: string): boolean {
  if (
    !isEligibleConversationMemorySource(text) ||
    text.length < 8 ||
    text.length > 1000 ||
    /[?？`<>「」“”"]|https?:\/\/|예를\s*들|가정|만약|라고\s*(말|했|해)|인용|번역|요약|기억|저장|비밀|남기지|기록하지|잊어|알려|보여|해줘|해주세요|부탁|만들어|인가요|가요|나요|까요|습니까|왜|어떤|어떻게|무엇|궁금|알고\s*싶|라면|다면/.test(
      text,
    )
  )
    return false;
  if (
    /(?:친구|가족|어머니|아버지|엄마|아빠|배우자|아내|남편|동료|동생|학생|딸|아들|조카|부모|할머니|할아버지|아이|자녀|환자)(?=\s|[은는이가의을를도와과께]|$)/.test(
      text,
    )
  )
    return false;
  // English opt-out, quoted/conditional framing and third-party subjects are not
  // eligible. Keep this conservative rather than treating a generic final period as proof.
  if (
    /\b(friend|mother|father|wife|husband|child|daughter|son|patient|someone|suppose|imagine|if|would|could|quote|said|told|forget|remember|store|save|private|confidential|secret|record|why|how|what|whether|might|may)\b|do\s+not|don't|for\s+example/i.test(
      text,
    )
  )
    return false;
  if (
    /^[A-Za-z]/.test(text) &&
    text.split(/[.!]/).filter(part => part.trim()).length !== 1
  )
    return false;
  return true;
}

/** Only fixed positive communication preferences may opt into the new model decision.
 * Free-form directives, negation, long-standing health claims and pasted text do
 * not gain admission through a model bit. Existing explicit and attributed paths remain separate. */
export function isProactiveMemoryStatement(request: string): boolean {
  const text = request.trim();
  if (/[\r\n]/.test(text) || !isSafeStatement(text)) return false;
  return (
    /^앞으로(?:는)? (?:한 번에 한 질문씩 듣고 싶어요|(?:답변|설명)(?:은|을) (?:짧게|간결하게|자세하게|한국어로|영어로|표로) (?:받고 싶어요|듣고 싶어요)|(?:짧은|간결한|자세한) (?:답변|설명)을 선호(?:해요|합니다))[.。]?$/.test(
      text,
    ) ||
    /^For future (?:replies|conversations), I prefer (?:(?:concise|short|brief|detailed) (?:replies|answers|explanations)|(?:replies|answers) in (?:Korean|English)|one question at a time)\.$/i.test(
      text,
    )
  );
}

/** Keep direct no-retention wording separate from statements about unrelated past or personal behavior. */
export function declinesStatementRetention(text: string): boolean {
  return (
    /\b(?:never|not|don't)\s+(?:retain|preserve|memorize|archive|log)\b|(?:보관|간직|수집)\s*하지(?:는|도)?\s*(?:말|않|마)/iu.test(
      text,
    ) ||
    /보존\s*하지(?:는|도)?\s*(?:말아\s*(?:주세요|줘)|말아요|마세요|마요|마)(?=$|[\s.!。])/u.test(
      text,
    ) ||
    /(?:^|[.!]\s+|,\s*|\b(?:but|and|please)\s+)don’t\s+(?:retain|preserve|memorize|archive|log)\s+(?:this(?:\s+(?:message|statement))?|it)\s*[.!]?$/iu.test(
      text,
    )
  );
}

/** Keep exact user-authored statements, not answers, diagnoses inferred by a model,
 * quoted documents, questions or hypothetical examples. This deliberately bounded
 * recognizer does not claim general language understanding. Uncertainty stays verbatim. */
export function conversationStatementMemory(
  value: ConversationArtifact,
): AgentMemoryInput | undefined {
  if (value.status !== 'complete' || value.submittedInput?.ocr)
    return undefined;
  const question = value.question.trim();
  if (question.length > 1000 || declinesStatementRetention(question))
    return undefined;
  // Parse only for eligibility. Persist the original verbatim so both JS and
  // the SQLite statement-time trigger can attest exactly the same source.
  const text = statementFromExplicitRequest(question) ?? question;
  if (!isSafeStatement(text)) return undefined;
  // Old serialized model advice never authorizes an embedding or recall write.
  // Korean often omits the speaker: a bounded health/topic subject may substitute
  // for first person, but this is retained as a dated statement, not an inferred diagnosis.
  if (
    !/^(저는|나는|제가|내가|제\s|내\s|I\s(?:am|have|prefer|want|need)|My\s)/i.test(
      text,
    ) &&
    !/^(오늘|어제|최근|요즘|작년|올해|평소|혈압|심박|수면|잠|운동|복용|알레르기|통증|두통|어지럼|식사|답변|설명)/.test(
      text,
    )
  )
    return undefined;
  if (
    !/(요|니다|했음|없음|있음|했어|있어|없어|좋아|싫어|싶어|[a-z]\.)[.!。]?$/i.test(
      text,
    )
  )
    return undefined;
  const preference = /선호|좋아|싫어|prefer/i.test(text);
  return {
    memoryKey: `conversation-statement:${value.id}`,
    text: `${value.createdAt} 사용자가 직접 말한 내용 (당시의 진술이며 현재 상태나 의학적으로 확인된 사실이 아님):\n${question}`,
    kind: preference ? 'preference' : 'task_context',
    importance: preference ? 0.8 : 0.6,
    provenance: {
      sourceIds: [value.id],
      sourceReferences: [{ kind: 'conversation_user_statement', id: value.id }],
      sourceDates: [{ sourceId: value.id, date: value.createdAt }],
      reviewState: 'user_stated',
    },
  };
}

/** Project the existing source without rewriting unknown dates or correction lineage. */
export function manualHistoryMemory(
  value: ManualHistoryEntry,
): AgentMemoryInput {
  return {
    memoryKey: `manual-history-memory:${value.id}`,
    text: `사용자가 직접 남긴 기록 (의학적 검증 아님). 기록 시각: ${value.recordedAt}. 발생일: ${value.effectiveDate.status === 'known' ? value.effectiveDate.date : '알 수 없음'}.\n${value.title}\n${value.details}`,
    kind: 'task_context',
    importance: 0.7,
    provenance: {
      sourceIds: [value.id],
      sourceReferences: [{ kind: 'manual_history', id: value.id }],
      sourceDates: [{ sourceId: value.id, date: value.recordedAt }],
      reviewState: 'user_stated',
    },
  };
}
