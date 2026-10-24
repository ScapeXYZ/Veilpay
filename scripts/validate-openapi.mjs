import { readFileSync } from "node:fs";
import { parse } from "yaml";

const spec = parse(readFileSync(new URL("../contracts/openapi.yaml", import.meta.url), "utf8"));
const operation = spec?.paths?.["/operator/mainnet/read-only"]?.get;
const snapshot = spec?.components?.schemas?.MainnetReadOnlySnapshot;
const security = spec?.components?.securitySchemes?.operatorReadToken;

function expect(condition, message) {
  if (!condition) throw new Error(`OpenAPI validation failed: ${message}`);
}

expect(spec?.openapi === "3.1.0", "expected OpenAPI 3.1.0");
expect(operation, "missing GET /operator/mainnet/read-only");
expect(JSON.stringify(operation.security) === JSON.stringify([{ operatorReadToken: [] }]), "operator endpoint must require operatorReadToken");
expect(operation.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/OperatorReadToken"), "missing required operator token header parameter");
expect(security?.type === "apiKey" && security.in === "header" && security.name === "X-VeilPay-Operator-Token", "operatorReadToken must be the X-VeilPay-Operator-Token header API key");
expect(JSON.stringify(Object.keys(operation.responses ?? {}).sort()) === JSON.stringify(["200", "401", "404", "503"]), "operator endpoint must document 200, 401, 404, and 503");
expect(operation.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/MainnetReadOnlySnapshot", "200 must return MainnetReadOnlySnapshot");
expect(snapshot?.properties?.network?.const === "mainnet", "snapshot must be mainnet-only");
expect(snapshot?.properties?.chainEvidence?.properties?.trusted?.const === false, "chain evidence must be explicitly untrusted");
expect(snapshot?.properties?.chainEvidence?.properties?.height?.type === "null", "independent chain height must be absent");

console.log("OpenAPI validation passed: schema, operator authentication, mainnet-only read-only response, and trust boundary.");
