import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite numbers are not valid JSON");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((key) => {
        const v = obj[key];
        if (v === undefined) {
          throw new Error(`Undefined is not valid JSON at key ${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalJson(v)}`;
      })
      .join(",")}}`;
  }

  throw new Error(`Unsupported JSON value type: ${typeof value}`);
}

export function sha256HexForJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
