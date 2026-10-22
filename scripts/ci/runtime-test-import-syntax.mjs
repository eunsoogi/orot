import { scanRegion } from './runtime-test-tokenizer.mjs';

function callSpecifier(tokens, openIndex) {
  const literal = tokens[openIndex + 1];
  return literal &&
    ['string', 'template'].includes(literal.type) &&
    literal.value !== null &&
    tokens[openIndex + 2]?.value === ')'
    ? literal.value
    : null;
}

function staticSource(tokens, startIndex) {
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.value === ';' ||
      (token.lineBreakBefore && ['import', 'export'].includes(token.value))
    )
      break;
    if (token.value === 'from' && tokens[index + 1]) {
      const literal = tokens[index + 1];
      if (['string', 'template'].includes(literal.type)) return literal.value;
    }
  }
  return undefined;
}

function declarationBinding(tokens, equalsIndex) {
  const binding = tokens[equalsIndex - 1];
  return binding?.type === 'identifier' &&
    ['const', 'let', 'var'].includes(tokens[equalsIndex - 2]?.value)
    ? binding.value
    : null;
}

function isDeclarationName(tokens, index) {
  return (
    ['const', 'let', 'var'].includes(tokens[index - 1]?.value) &&
    tokens[index + 1]?.value === '=' &&
    tokens[index]?.type === 'identifier'
  );
}

function aliasBinding(tokens, index, aliases) {
  if (tokens[index].value === 'require' && tokens[index - 1]?.value === '=')
    return declarationBinding(tokens, index - 1);
  if (
    tokens[index].value === 'require' &&
    tokens[index - 1]?.value === '.' &&
    tokens[index - 2]?.type === 'identifier' &&
    tokens[index - 3]?.value === '='
  )
    return declarationBinding(tokens, index - 3);
  if (aliases.has(tokens[index].value) && tokens[index - 1]?.value === '=')
    return declarationBinding(tokens, index - 1);
  return null;
}

function endsAliasValue(tokens, index) {
  const next = tokens[index + 1];
  return !next || next.lineBreakBefore || [';', ','].includes(next.value);
}

/** Extract literal module edges and flag loaders whose target cannot be proven. */
export function scanModuleSpecifiers(source) {
  const tokens = scanRegion(source).tokens;
  const specifiers = [];
  const dynamicLoaders = new Set();
  const loaderAliases = new Set();
  // Follow copied loader values so computed calls cannot look like missing edges.
  let addedAlias;
  do {
    addedAlias = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const binding = aliasBinding(tokens, index, loaderAliases);
      if (binding && endsAliasValue(tokens, index) && !loaderAliases.has(binding)) {
        loaderAliases.add(binding);
        addedAlias = true;
      }
    }
  } while (addedAlias);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.type === 'string' &&
      token.value === 'require' &&
      tokens[index - 1]?.value === '[' &&
      tokens[index + 1]?.value === ']'
    ) {
      dynamicLoaders.add('dynamic-module-loader');
      continue;
    }
    if (token.type !== 'identifier') continue;
    const next = tokens[index + 1];
    if (token.value === 'import') {
      if (next?.value === '.') continue;
      if (next?.value === '(') {
        const specifier = callSpecifier(tokens, index + 1);
        if (specifier === null) dynamicLoaders.add('dynamic-module-loader');
        else specifiers.push(specifier);
      } else if (next?.value !== 'type' && next?.value !== 'typeof') {
        const sideEffect = ['string', 'template'].includes(next?.type) ? next.value : undefined;
        const specifier = sideEffect ?? staticSource(tokens, index + 1);
        if (specifier === undefined || specifier === null)
          dynamicLoaders.add('unresolved-static-import');
        else specifiers.push(specifier);
      }
    } else if (token.value === 'export' && next?.value !== 'type') {
      const specifier = staticSource(tokens, index + 1);
      if (specifier !== undefined && specifier !== null) specifiers.push(specifier);
    } else if (token.value === 'require' || loaderAliases.has(token.value)) {
      const directCall = next?.value === '(';
      const resolutionCall =
        next?.value === '.' &&
        tokens[index + 2]?.value === 'resolve' &&
        tokens[index + 3]?.value === '(';
      if (directCall || resolutionCall) {
        const openIndex = directCall ? index + 1 : index + 3;
        const specifier = callSpecifier(tokens, openIndex);
        if (specifier === null) dynamicLoaders.add('dynamic-module-loader');
        else specifiers.push(specifier);
      } else if (aliasBinding(tokens, index, loaderAliases) && endsAliasValue(tokens, index)) {
        continue;
      } else if (!isDeclarationName(tokens, index)) {
        // Passing or transforming a loader can hide a module edge from this static scanner.
        dynamicLoaders.add('dynamic-module-loader');
      }
    } else if (token.value === 'createRequire') {
      dynamicLoaders.add('dynamic-module-loader');
    } else if (['eval', 'Function'].includes(token.value)) {
      // Aliasing or passing either dynamic-code entry point defeats literal import resolution.
      dynamicLoaders.add('dynamic-code-loader');
    } else if (token.value === 'importScripts') {
      dynamicLoaders.add('dynamic-module-loader');
    }
  }
  return { specifiers, unknownReason: [...dynamicLoaders].sort()[0] ?? null };
}
