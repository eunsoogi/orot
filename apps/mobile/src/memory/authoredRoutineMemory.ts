import { isProactiveMemoryStatement } from './userStatementMemory';
import type { LocalConversationMemoryScope } from '../storage/ordinaryConversationMemoryEnrollment';
import { isEligibleConversationMemorySource } from '../manualHistory/conversationHistoryIntent';

// Closed bilingual vocabulary makes this first opt-in useful for recurring
// practice without copying an arbitrary topic, private name, token, or fact.
const englishActivity =
  '(?:read books|write in my journal|practice drawing|practice (?:the )?(?:piano|guitar)|study (?:English|Korean|Spanish|French))';
const englishRecurrence =
  '(?:every (?:day|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|weekday|weekend)|on weekends|twice a week)';
const english = new RegExp(
  `^(?:I|As part of my routine, I) ${englishActivity} ${englishRecurrence}\\.$`,
  'i',
);
const korean =
  /^(?:(?:저는|나는) )?(?:매일|매주 [월화수목금토일]요일|주말마다|평일마다|일주일에 두 번) (?:책을 (?:읽어요|읽습니다)|일기를 (?:써요|씁니다)|그림을 (?:그려요|그립니다)|(?:피아노|기타)를 연습(?:해요|합니다)|(?:영어|한국어|스페인어|프랑스어)를 공부(?:해요|합니다))[.。]?$/u;

/** Author a recurring action; asking about one or mentioning when it happened
 * is not authorization to manufacture a lasting fact. No parsing of answers. */
export function isAuthoredRoutineMemoryStatement(question: string): boolean {
  return (
    question === question.trim() &&
    !/[\r\n]/u.test(question) &&
    isEligibleConversationMemorySource(question) &&
    (english.test(question) || korean.test(question))
  );
}

/** One current message chooses at most one disclosed policy before any await.
 * Permission for the other category cannot substitute for an absent grant. */
export function localConversationMemoryScope(
  question: string,
): LocalConversationMemoryScope | undefined {
  if (isProactiveMemoryStatement(question)) return 'reply-preferences';
  if (isAuthoredRoutineMemoryStatement(question)) return 'authored-routine';
}
