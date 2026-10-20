import type { AppleNativeSchema } from './schema-types';
import type { JsonObject } from '@orot/model-runtime';
import { cleanName } from './schema-helpers';

/** SDK identities are internal names, not output keys or citation IDs. Share one
 * mapping across a request's tool/answer schemas so distinct types stay distinct
 * without repeating long generated ancestry paths in the model context.
 */
export function createCompactSchemaNames() {
  const names = new Map<string, string>();
  const nameFor = (name: string, title: unknown) => {
    if (!names.has(name))
      names.set(
        name,
        'S' +
          (names.size + 1) +
          (typeof title === 'string' ? cleanName(title) : ''),
      );
    return names.get(name)!;
  };
  // The already-validated source schema preserves authored titles separately
  // from generated ancestry; stripping a name must not strip model guidance.
  const compact = (
    schema: AppleNativeSchema,
    raw?: JsonObject,
  ): AppleNativeSchema => {
    switch (schema.kind) {
      case 'array':
        return {
          ...schema,
          item: compact(schema.item, raw?.items as JsonObject | undefined),
        };
      case 'enum':
        return { ...schema, name: nameFor(schema.name, raw?.title) };
      case 'union':
        return {
          ...schema,
          name: nameFor(schema.name, raw?.title),
          choices: schema.choices.map((choice, index) =>
            compact(
              choice,
              (raw?.anyOf as readonly JsonObject[] | undefined)?.[index],
            ),
          ),
        };
      case 'object':
        return {
          ...schema,
          name: nameFor(schema.name, raw?.title),
          properties: schema.properties.map(property => ({
            ...property,
            schema: compact(
              property.schema,
              (raw?.properties as Record<string, JsonObject> | undefined)?.[
                property.name
              ],
            ),
          })),
        };
      default:
        return schema;
    }
  };
  return compact;
}
