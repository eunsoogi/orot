import type { JsonObject, JsonValue } from '@orot/model-runtime';

/**
 * Native guidance is a generation aid. Task/tool validators still enforce the original
 * length, uniqueness and union constraints before any result or tool dispatch is accepted.
 * Unknown keywords remain present so providers reject unsupported shapes explicitly.
 */
export function guidedSchema(schema: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['minLength', 'maxLength', 'uniqueItems', 'minimum', 'maximum'].includes(key)) continue;
    if (key === 'const' && typeof value === 'string') {
      result.enum = [value];
    } else if ((key === 'oneOf' || key === 'anyOf') && Array.isArray(value)) {
      result.anyOf = value.map((item) => guidedSchema(item as JsonObject));
    } else if (
      key === 'properties' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, field]) => [name, guidedSchema(field as JsonObject)]),
      );
    } else if (key === 'items' && value && typeof value === 'object' && !Array.isArray(value)) {
      result.items = guidedSchema(value as JsonObject);
    } else result[key] = value;
  }
  return result;
}
