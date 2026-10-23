import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Money is integer zatoshi strings + BigInt only (contract v1.1).
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Zatoshi math is BigInt only (src/lib/zat.ts)." }],
      "no-restricted-properties": [
        "error",
        { object: "localStorage", message: "No client storage for payment/session data." },
        { object: "sessionStorage", message: "No client storage for payment/session data." },
      ],
    },
  },
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
];

export default config;
