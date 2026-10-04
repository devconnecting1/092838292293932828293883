/**
 * Carga local da lista oficial da Caixa, pela mesma função da tela
 * /plataforma/caixa (`runCaixaCatalogImport`): mesmo leitor, mesmas validações
 * e as mesmas RPCs com CAIXA_SERVER_KEY (nunca service_role).
 *
 *   cd apps/web
 *   npm run caixa:importar -- "C:\caminho\Lista_imoveis_geral.csv" --simular
 *   npm run caixa:importar -- "C:\caminho\Lista_imoveis_geral.csv"
 *
 * `--simular` só lê e valida o arquivo e imprime o resumo: não conecta ao
 * banco, não precisa da chave e não grava nada. Sem ele, lê
 * NEXT_PUBLIC_SUPABASE_URL, a chave publishable e CAIXA_SERVER_KEY do
 * apps/web/.env.local e grava o catálogo.
 *
 * Imprime só contagens e o nome do arquivo. Nunca imprime chave nem dado de
 * imóvel. Nenhuma requisição ao site da Caixa: o arquivo é o que alguém baixou
 * no navegador.
 *
 * O `npm run` empacota este arquivo com o esbuild do monorepo (condição
 * `react-server`, para o `server-only` de lib/caixa/ingest.ts valer como no
 * servidor Next) e roda o resultado com o Node.
 */

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  CAIXA_MAX_FILE_BYTES,
  decodeCaixaCsvBytes,
  type CaixaListSummary,
  type CaixaSyncOutcome,
} from "@workspace/core/caixa/catalog-import"
import type { CaixaRejectionReason } from "@workspace/core/caixa/csv"
import { formatBrDate } from "@workspace/core/caixa/normalize"

import { digestCaixaListBytes, runCaixaCatalogImport } from "@/lib/caixa/ingest"
import { CAIXA_FAILURE_MESSAGES, CAIXA_REJECTION_LABELS } from "@/lib/plataforma/caixa-labels"

const numberFormat = new Intl.NumberFormat("pt-BR")
const megabytes = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

const USAGE = `Uso (dentro de apps/web):
  npm run caixa:importar -- "<caminho do Lista_imoveis_geral.csv>" [--simular]

  --simular   só valida e resume o arquivo; não grava nada nem conecta ao banco`

function fail(message: string): never {
  console.error(`\nErro: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  let simulate = false
  let file: string | null = null

  for (const arg of argv) {
    if (arg === "--simular") {
      simulate = true
    } else if (arg === "--ajuda" || arg === "-h" || arg === "--help") {
      console.log(USAGE)
      process.exit(0)
    } else if (arg.startsWith("-")) {
      fail(`opção desconhecida: ${arg}\n\n${USAGE}`)
    } else if (file) {
      fail(`informe um arquivo só.\n\n${USAGE}`)
    } else {
      file = arg
    }
  }

  if (!file) {
    fail(`informe o caminho do arquivo .csv.\n\n${USAGE}`)
  }

  return { simulate, file }
}

/** apps/web/.env.local (o npm run roda com a pasta do pacote como diretório atual). */
function loadLocalEnv(required: boolean) {
  const envPath = path.resolve(process.cwd(), ".env.local")

  // Tenta ler direto (sem checar antes se existe, para o arquivo não mudar no
  // meio). Não sobrescreve variáveis que já estejam no ambiente.
  try {
    process.loadEnvFile(envPath)
  } catch (cause) {
    const missing = (cause as NodeJS.ErrnoException | null)?.code === "ENOENT"

    if (!missing) {
      fail("não foi possível ler apps/web/.env.local.")
    }

    if (required) {
      fail("apps/web/.env.local não encontrado. Rode o comando dentro de apps/web.")
    }
  }
}

function rejectionLines(byReason: Partial<Record<CaixaRejectionReason, number>>) {
  return (Object.entries(byReason) as [CaixaRejectionReason, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([reason, count]) => `    ${numberFormat.format(count)}  ${CAIXA_REJECTION_LABELS[reason]}`
    )
}

function printFileSummary(file: CaixaListSummary) {
  console.log(`  Data declarada pela Caixa: ${formatBrDate(file.generatedOn) ?? "não informada"}`)
  console.log(
    `  Imóveis válidos: ${numberFormat.format(file.accepted)} em ${numberFormat.format(file.states)} UFs`
  )
  console.log(`  Linhas recusadas: ${numberFormat.format(file.rejected)}`)

  for (const line of rejectionLines(file.rejectedByReason)) {
    console.log(line)
  }
}

function failureMessage(outcome: Extract<CaixaSyncOutcome, { ok: false }>) {
  if (outcome.reason === "sem_chave_do_servidor") {
    return "falta CAIXA_SERVER_KEY em apps/web/.env.local (valor do segredo caixa_server_key do Vault). Nada foi gravado."
  }

  if (outcome.reason === "supabase_nao_configurado") {
    return "faltam NEXT_PUBLIC_SUPABASE_URL e a chave publishable em apps/web/.env.local. Nada foi gravado."
  }

  return CAIXA_FAILURE_MESSAGES[outcome.reason]
}

/**
 * Abre o arquivo UMA vez e confere tipo e tamanho pelo mesmo descritor que é
 * lido: checar o caminho e ler depois deixaria o arquivo mudar no meio.
 */
function readListFile(filePath: string): Uint8Array {
  let fd: number

  try {
    fd = openSync(filePath, "r")
  } catch {
    fail(`arquivo não encontrado: ${filePath}`)
  }

  try {
    const stats = fstatSync(fd)

    if (!stats.isFile()) {
      fail(`arquivo não encontrado: ${filePath}`)
    }

    if (stats.size === 0) {
      fail("o arquivo está vazio.")
    }

    if (stats.size > CAIXA_MAX_FILE_BYTES) {
      fail("o arquivo passa de 20 MB. Confira se é a lista da Caixa.")
    }

    const bytes = new Uint8Array(readFileSync(fd))

    // O arquivo pode ter crescido entre a conferência e a leitura.
    if (bytes.byteLength === 0 || bytes.byteLength > CAIXA_MAX_FILE_BYTES) {
      fail("o arquivo mudou durante a leitura. Tente de novo.")
    }

    return bytes
  } finally {
    closeSync(fd)
  }
}

async function main() {
  const { simulate, file } = parseArgs(process.argv.slice(2))
  // Caminho relativo: a partir de onde o npm foi chamado (INIT_CWD, definido pelo
  // próprio npm), não de apps/web. Não é configuração do app, por isso fica fora do turbo.json.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const filePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), file)

  const bytes = readListFile(filePath)
  const size = bytes.byteLength

  loadLocalEnv(!simulate)

  const digest = digestCaixaListBytes(bytes)

  console.log(`\nLista da Caixa — ${simulate ? "SIMULAÇÃO (nada será gravado)" : "carga no banco"}`)
  console.log(
    `  Arquivo: ${path.basename(filePath)} (${megabytes.format(size / (1024 * 1024))} MB, SHA-256 ${digest.slice(0, 12)}…)`
  )

  const startedAt = Date.now()
  const outcome = await runCaixaCatalogImport(decodeCaixaCsvBytes(bytes), { digest, simulate })
  const seconds = megabytes.format((Date.now() - startedAt) / 1000)

  if (!outcome.ok) {
    if (outcome.file) {
      printFileSummary(outcome.file)
    }

    fail(failureMessage(outcome))
  }

  if (outcome.result === "simulated") {
    printFileSummary(outcome.file)
    console.log(`  Lotes que a carga mandaria ao banco: ${numberFormat.format(outcome.batches)}`)
    console.log(`\nResultado: arquivo válido, pronto para carregar (${seconds} s).\n`)
    return
  }

  if (outcome.result !== "changed") {
    console.log("\nResultado: nada mudou — este arquivo é igual ao da última carga.\n")
    return
  }

  printFileSummary(outcome.file)
  console.log(
    `\nResultado: catálogo atualizado em ${seconds} s.\n` +
      `  ${numberFormat.format(outcome.total)} imóveis ativos · ${numberFormat.format(outcome.inserted)} novos · ` +
      `${numberFormat.format(outcome.updated)} atualizados · ${numberFormat.format(outcome.delisted)} saíram da lista · ` +
      `${numberFormat.format(outcome.rejected)} recusados (arquivo + banco)\n`
  )
}

main().catch((cause: unknown) => {
  // Só o tipo do erro: a mensagem de um erro inesperado não é impressa inteira.
  fail(`falha inesperada (${cause instanceof Error ? cause.name : "erro"}).`)
})
