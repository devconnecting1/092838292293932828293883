// Ponto de entrada de `@workspace/core/billing`: o package.json exporta
// "./*" → "./src/*.ts", então o import resolve para este arquivo.

export * from "./billing/index"
