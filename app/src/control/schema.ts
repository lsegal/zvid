// The JSON Schema subset the control surface describes its command inputs
// with, and a validator for it. Inputs are flat objects of strings, numbers,
// booleans and enums, which every tool-calling model handles, so this is all
// the schema the commands need.

export type ControlPropertySchema =
  | {
      type: "string";
      description: string;
      enum?: readonly string[];
      minLength?: number;
    }
  | {
      type: "number" | "integer";
      description: string;
      minimum?: number;
      maximum?: number;
      exclusiveMinimum?: number;
    }
  | { type: "boolean"; description: string }
  // A parameter value: a number, or a string for enum, color and text
  // parameters.
  | { type: ["number", "string"]; description: string };

export type ControlInputSchema = {
  type: "object";
  properties: Record<string, ControlPropertySchema>;
  required?: readonly string[];
  additionalProperties: false;
};

export type ControlInput = Record<string, unknown>;

export function objectSchema(
  properties: Record<string, ControlPropertySchema>,
  required: readonly string[] = [],
): ControlInputSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function typeOf(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkProperty(
  key: string,
  schema: ControlPropertySchema,
  value: unknown,
): string | undefined {
  if (Array.isArray(schema.type)) {
    return (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "string"
      ? undefined
      : `"${key}" must be a number or a string, not ${typeOf(value)}.`;
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        return `"${key}" must be a string, not ${typeOf(value)}.`;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `"${key}" must be one of ${schema.enum.map((option) => `"${option}"`).join(", ")}.`;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `"${key}" must not be empty.`;
      }
      return undefined;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `"${key}" must be a boolean, not ${typeOf(value)}.`;
    default: {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `"${key}" must be a finite number, not ${typeOf(value)}.`;
      }
      if (schema.type === "integer" && !Number.isInteger(value)) {
        return `"${key}" must be a whole number.`;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return `"${key}" must be at least ${schema.minimum}.`;
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return `"${key}" must be at most ${schema.maximum}.`;
      }
      if (
        schema.exclusiveMinimum !== undefined &&
        value <= schema.exclusiveMinimum
      ) {
        return `"${key}" must be greater than ${schema.exclusiveMinimum}.`;
      }
      return undefined;
    }
  }
}

/**
 * The problems with `input` against `schema`, one message per problem; empty
 * when it is valid. A missing input counts as `{}`.
 */
export function validateInput(
  schema: ControlInputSchema,
  input: unknown,
): string[] {
  const value = input ?? {};
  if (typeOf(value) !== "object") {
    return [`The input must be an object, not ${typeOf(value)}.`];
  }
  const record = value as ControlInput;
  const problems: string[] = [];
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) {
      problems.push(`"${key}" is required.`);
    }
  }
  for (const [key, propertyValue] of Object.entries(record)) {
    const property = schema.properties[key];
    if (!property) {
      const known = Object.keys(schema.properties);
      problems.push(
        known.length
          ? `"${key}" is not an input of this command; it takes ${known.map((name) => `"${name}"`).join(", ")}.`
          : `"${key}" is not an input of this command; it takes none.`,
      );
      continue;
    }
    if (propertyValue === undefined) {
      continue;
    }
    const problem = checkProperty(key, property, propertyValue);
    if (problem) {
      problems.push(problem);
    }
  }
  return problems;
}
