type JsonSchema = Record<string, unknown>;

function firstNumericBoundary(schema: JsonSchema): number {
  if (typeof schema.minimum === "number") return schema.minimum;
  if (typeof schema.exclusiveMinimum === "number") {
    return schema.type === "integer"
      ? Math.floor(schema.exclusiveMinimum) + 1
      : schema.exclusiveMinimum + 1;
  }
  return 1;
}

function exampleForSchema(schema: JsonSchema): unknown {
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (alternatives) {
    const first = alternatives[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("Discovery schema contains a malformed alternative");
    }
    return exampleForSchema(first as JsonSchema);
  }

  switch (schema.type) {
    case "object": {
      const properties =
        typeof schema.properties === "object" && schema.properties !== null
          ? (schema.properties as Record<string, unknown>)
          : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      return Object.fromEntries(
        required.map((name) => {
          if (typeof name !== "string") {
            throw new Error("Discovery schema contains a non-string required property");
          }
          const property = properties[name];
          if (typeof property !== "object" || property === null) {
            throw new Error(`Discovery schema is missing required property ${name}`);
          }
          return [name, exampleForSchema(property as JsonSchema)];
        }),
      );
    }
    case "array":
      return [];
    case "boolean":
      return true;
    case "integer":
    case "number":
      return firstNumericBoundary(schema);
    case "string":
      if (schema.format === "date-time") return "1970-01-01T00:00:00.000Z";
      return "example";
    case "null":
      return null;
    default:
      throw new Error(`Unsupported discovery schema type: ${String(schema.type)}`);
  }
}

/**
 * The pinned Bazaar 2.20 declaration validates its example against inputSchema.
 * Derive the smallest valid example from the canonical tool schema rather than
 * maintaining surface-local request examples. API assumption verified 2026-07-29.
 */
export function discoveryInputExample(schema: JsonSchema): Record<string, unknown> {
  const example = exampleForSchema(schema);
  if (typeof example !== "object" || example === null || Array.isArray(example)) {
    throw new Error("Hosted tool input schema must produce an object example");
  }
  return example as Record<string, unknown>;
}
