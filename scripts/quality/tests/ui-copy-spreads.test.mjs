import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDirectKoreanCopy } from '../ui-copy-audit.mjs';

test('checks display fields in direct JSX object spreads, including scalar aliases', () => {
  for (const source of [
    '<Button {...{ title: "합성 제목" }} />',
    '<Button {...({ "accessibilityLabel": `합성 이름` } as const)} />',
    '<Input {...({ placeholder: "합성 입력" } satisfies Props)} />',
    'const title="합성 제목"; const view=<Button {...{title}}/>;',
    'const title="합성 제목"; const view=<Button {...{label:title}}/>;',
  ])
    assert.equal(findDirectKoreanCopy(source).length, 1, source);
});

test('does not interpret unknown spreads, computed fields, callbacks or record payloads', () => {
  for (const source of [
    '<Button {...{onPress: () => submit("모델 지시"), data: {text:"저장 원문"}}}/>',
    '<Button {...{["title"]: "동적 이름", get label(){return "원문";}}}/>',
    'const props={title:"저장 원문"}; const view=<Button {...props}/>;',
    '<Button {...makeProps("모델 지시")}/>',
    '<Button {...(ready ? {title:"동적 원문"} : other)}/>',
  ])
    assert.deepEqual(findDirectKoreanCopy(source), [], source);
});

test('inspects only explicit spread fields and deduplicates shared declarations', () => {
  const source =
    'const title="합성 제목"; const view=<Button title={title} {...{...unknown,title, onPress:()=>send("지시")}}/>;';
  assert.equal(findDirectKoreanCopy(source).length, 1);
  assert.equal(
    findDirectKoreanCopy('<Button {...{ title: ready ? "합성" : t("other") }}/>').length,
    1,
  );
});
