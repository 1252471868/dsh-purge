/** Add explicit object openness required by DSH 0.2.1; preserve declared choices. */
export function sealObjectSchemas(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sealObjectSchemas);
  const result = { ...schema };
  if (result.type === "object" && result.additionalProperties === undefined) {
    result.additionalProperties = !result.properties;
  }
  // Traverse schema positions only. Defaults/examples may themselves contain "type".
  for (const key of ["properties", "$defs", "definitions", "patternProperties"]) {
    if (result[key]) result[key] = Object.fromEntries(
      Object.entries(result[key]).map(([name, value]) => [name, sealObjectSchemas(value)]));
  }
  for (const key of ["items", "additionalProperties", "anyOf", "allOf", "oneOf", "not", "if", "then", "else"]) {
    if (result[key] && typeof result[key] === "object") result[key] = sealObjectSchemas(result[key]);
  }
  return result;
}
