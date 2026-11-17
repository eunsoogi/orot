import type { AgentMemoryInput } from '@orot/agent-memory';
import type { ConversationArtifact } from '../storage/conversationArtifactTypes';
import type { ManualHistoryEntry } from '@orot/domain';

/** Keep exact user-authored statements, not answers, diagnoses inferred by a model,
 * quoted documents, questions or hypothetical examples. This deliberately bounded
 * recognizer does not claim general language understanding. Uncertainty stays verbatim. */
export function conversationStatementMemory(
  value: ConversationArtifact,
): AgentMemoryInput | undefined {
  if (value.status !== 'complete' || value.submittedInput?.ocr)
    return undefined;
  const text = value.question.trim();
  if (
    text.length < 8 ||
    text.length > 1000 ||
    /[?？`<>「」“”"]|https?:\/\/|예를\s*들|가정|만약|라고\s*(말|했|해)|인용|번역|요약|기억|저장|비밀|남기지|기록하지|잊어|알려|보여|해줘|해주세요|부탁|만들어|인가요|가요|나요|까요|습니까|왜|어떤|어떻게|무엇|궁금|알고\s*싶|라면|다면/.test(
      text,
    )
  )
    return undefined;
  if (
    /(?:친구|가족|어머니|아버지|엄마|아빠|배우자|아내|남편|동료|동생|학생|딸|아들|조카|부모|할머니|할아버지|아이|자녀|환자)(?=\s|[은는이가의을를도와과께]|$)/.test(
      text,
    )
  )
    return undefined;
  // English opt-out, quoted/conditional framing and third-party subjects are not
  // eligible. Keep this conservative rather than treating a generic final period as proof.
  if (
    /\b(friend|mother|father|wife|husband|child|daughter|son|patient|someone|suppose|imagine|if|would|could|quote|said|told|forget|remember|store|save|private|confidential|secret|record|why|how|what|whether|might|may)\b|do\s+not|don't|for\s+example/i.test(
      text,
    )
  )
    return undefined;
  if (
    /^[A-Za-z]/.test(text) &&
    text.split(/[.!]/).filter(part => part.trim()).length !== 1
  )
    return undefined;
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
    text: `${value.createdAt} 사용자가 직접 말한 내용 (당시의 진술이며 현재 상태나 의학적으로 확인된 사실이 아님):\n${text}`,
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
