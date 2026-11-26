import assert from 'node:assert/strict';

export function swiftTestMethodsInDeclaration(source, suite, kind, withPositions = false) {
  const code = maskSwiftCommentsAndStrings(source);
  const declaration =
    /^\s*(?:(?:final|public|private|internal|open)\s+)?(class|extension)\s+([A-Za-z_]\w*)\b[^\n{]*\{/gm;
  const suiteDeclarations = [...code.matchAll(declaration)].filter(
    (match) => match[1] === kind && match[2] === suite && swiftBraceDepth(code, match.index) === 0,
  );
  return suiteDeclarations.flatMap((suiteDeclaration) => {
    const openIndex = suiteDeclaration.index + suiteDeclaration[0].lastIndexOf('{');
    const closeIndex = swiftClosingBrace(code, openIndex);
    assert.notEqual(closeIndex, -1, `Unclosed Swift ${kind} ${suite}`);
    const body = code.slice(openIndex + 1, closeIndex);
    return [...body.matchAll(/\bfunc\s+(test\w+)\s*\(/g)]
      .filter((match) => swiftBraceDepth(body, match.index) === 0)
      .map((match) => (withPositions ? openIndex + 1 + match.index : match[1]));
  });
}
export function maskSwiftCommentsAndStrings(source) {
  return source.replace(
    /#"(?:\\.|[^"\\])*"#|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (value) => value.replace(/[^\n]/g, ' '),
  );
}
function swiftBraceDepth(source, end) {
  let depth = 0;
  for (let index = 0; index < end; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
  }
  return depth;
}

function swiftClosingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}
