/**
 * Guards against contract drift: walks every schema in contracts/openapi.yaml and
 * checks the matching Zod schema has the same property names, the same required set,
 * the same enum values and the same nullability. Any change to the YAML fails here
 * until schemas.ts is updated (and the change is agreed with the backend first).
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import { contractSchemas } from "./schemas";

const YAML_PATH = path.resolve(__dirname, "../../../contracts/openapi.yaml");
const raw = readFileSync(YAML_PATH, "utf8");
const doc = parse(raw) as { info: { version: string }; components: { schemas: Record<string, OA> } };

type OA = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, OA>;
  required?: string[];
  enum?: unknown[];
  items?: OA;
  allOf?: OA[];
  oneOf?: OA[];
  anyOf?: OA[];
  nullable?: boolean;
  const?: unknown;
};

function resolve(s: OA): OA {
  if (s.$ref) return resolve(doc.components.schemas[s.$ref.split("/").pop()!]);
  if (s.allOf) {
    const out: OA = { type: "object", properties: {}, required: [] };
    for (const part of s.allOf.map(resolve)) {
      Object.assign(out.properties!, part.properties ?? {});
      out.required!.push(...(part.required ?? []));
    }
    return out;
  }
  return s;
}

function isNullableOA(s: OA): boolean {
  const r = s.$ref ? resolve(s) : s;
  if (Array.isArray(r.type) && r.type.includes("null")) return true;
  if (r.nullable) return true;
  const alts = r.oneOf ?? r.anyOf;
  return !!alts?.some((a) => a.type === "null" || (Array.isArray(a.type) && a.type.includes("null")));
}

type Z = z.ZodType & { def: { type: string; innerType?: Z; shape?: Record<string, Z>; element?: Z; entries?: Record<string, string>; values?: unknown[]; in?: Z } };

function unwrap(s: Z): { inner: Z; optional: boolean; nullable: boolean } {
  let optional = false;
  let nullable = false;
  let cur = s;
  for (;;) {
    const t = cur.def.type;
    if (t === "optional") optional = true;
    else if (t === "nullable") nullable = true;
    else break;
    cur = cur.def.innerType!;
  }
  return { inner: cur, optional, nullable };
}

function zodEnumValues(s: Z): unknown[] | null {
  if (s.def.type === "enum") return Object.values(s.def.entries!);
  if (s.def.type === "literal") return s.def.values!;
  return null;
}

function compare(name: string, oa: OA, zs: Z, problems: string[]) {
  const r = resolve(oa);
  const { inner } = unwrap(zs);
  const oaEnum = r.enum?.filter((v) => v !== null);
  if (oaEnum) {
    const ze = zodEnumValues(inner);
    if (!ze) problems.push(`${name}: contract enum but zod is ${inner.def.type}`);
    else if (JSON.stringify([...ze].sort()) !== JSON.stringify([...oaEnum].sort()))
      problems.push(`${name}: enum ${JSON.stringify(oaEnum)} vs zod ${JSON.stringify(ze)}`);
    return;
  }
  const props = r.properties;
  if (props) {
    if (inner.def.type !== "object") {
      problems.push(`${name}: contract object but zod is ${inner.def.type}`);
      return;
    }
    const shape = inner.def.shape!;
    const oaKeys = Object.keys(props).sort();
    const zKeys = Object.keys(shape).sort();
    if (JSON.stringify(oaKeys) !== JSON.stringify(zKeys))
      problems.push(`${name}: properties ${JSON.stringify(oaKeys)} vs zod ${JSON.stringify(zKeys)}`);
    const required = new Set(r.required ?? []);
    for (const key of oaKeys) {
      const zf = shape[key];
      if (!zf) continue;
      const u = unwrap(zf);
      if (required.has(key) === u.optional) problems.push(`${name}.${key}: required=${required.has(key)} but zod optional=${u.optional}`);
      if (isNullableOA(props[key]) !== u.nullable)
        problems.push(`${name}.${key}: nullable=${isNullableOA(props[key])} but zod nullable=${u.nullable}`);
      compare(`${name}.${key}`, props[key], zf, problems);
    }
    return;
  }
  if (r.items && inner.def.type === "array") compare(`${name}[]`, r.items, inner.def.element!, problems);
}

describe("contract v1.1 sync", () => {
  it("is the frozen v1.1 contract", () => {
    // The approved file still carries info.version "1.1.0-draft"; the sha pins the approved bytes.
    expect(doc.info.version).toBe("1.1.0-draft");
    expect(createHash("sha256").update(raw).digest("hex").slice(0, 12)).toBe("39f4d75786a8");
  });

  it("has a Zod schema for every contract schema", () => {
    const missing = Object.keys(doc.components.schemas).filter(
      (k) => !(k in contractSchemas) && !["Failure", "SessionContext"].includes(k),
    );
    expect(missing).toEqual([]);
  });

  it("detects drift (walker self-test)", async () => {
    const { z } = await import("zod");
    const drifted = z.object({ status: z.enum(["ok", "down"]), extra: z.string() });
    const problems: string[] = [];
    compare("Health", doc.components.schemas.Health, drifted as unknown as Z, problems);
    expect(problems.length).toBeGreaterThan(0);
  });

  for (const [name, zs] of Object.entries(contractSchemas)) {
    it(`${name} matches the contract`, () => {
      const oa = doc.components.schemas[name];
      expect(oa, `contract has no schema ${name}`).toBeDefined();
      const problems: string[] = [];
      compare(name, oa, zs as unknown as Z, problems);
      expect(problems).toEqual([]);
    });
  }
});
