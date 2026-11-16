import ts from 'typescript';

/** Resolve same-file scalar const aliases with lexical binding, never imports or mutable data.
 * The in-memory, no-lib program cannot read dependencies, user records or external files. */
export function displayCopyAliases(parsed) {
  let checker;
  const visited = new Set();
  return (node) => {
    if (!ts.isIdentifier(node)) return undefined;
    if (!checker) {
      const host = {
        getSourceFile: (name) => (name === parsed.fileName ? parsed : undefined),
        getDefaultLibFileName: () => '',
        writeFile: () => {},
        getCurrentDirectory: () => '',
        getDirectories: () => [],
        fileExists: (name) => name === parsed.fileName,
        readFile: () => undefined,
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
      };
      checker = ts
        .createProgram([parsed.fileName], { noLib: true, noResolve: true }, host)
        .getTypeChecker();
    }
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (
      !declaration ||
      visited.has(declaration) ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer
    )
      return undefined;
    const value = declaration.initializer;
    // Objects, arrays, calls and callbacks may contain non-display fields or instructions.
    // Only scalar aliases/wrappers are followed; dynamic dataflow remains a manual audit.
    if (!(
      ts.isIdentifier(value) ||
      ts.isStringLiteral(value) ||
      ts.isNoSubstitutionTemplateLiteral(value) ||
      ts.isTemplateExpression(value) ||
      ts.isConditionalExpression(value) ||
      ts.isBinaryExpression(value) ||
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isNonNullExpression(value)
    ))
      return undefined;
    visited.add(declaration);
    return value;
  };
}
