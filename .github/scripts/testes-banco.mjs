#!/usr/bin/env node
/**
 * Roda os testes SQL de supabase/tests contra o banco LOCAL do Supabase (CI).
 *
 * Convenção dos testes: cada arquivo é um bloco `do $$ ... $$;` que cria os dados,
 * confere tudo e termina de propósito com `raise exception` (SQLSTATE P0001) trazendo
 * o resultado em JSON na mensagem; a transação inteira é desfeita. Formatos em uso:
 *   raise exception 'TESTE ... (rollback): %', jsonb_pretty(r);
 *   raise exception 'RESULTADO: %', jsonb_pretty(r);
 *   raise exception using errcode = 'P0001', message = jsonb_pretty(r);
 *
 * Um arquivo PASSA quando:
 *   1. o psql termina com erro P0001 cuja mensagem traz um objeto JSON; e
 *   2. se o cabeçalho tem "Resultado esperado", cada linha legível sem ambiguidade
 *      (`--   chave : valor-em-JSON`, ou `a / b : valor`) bate com o JSON devolvido.
 *      "Todas as chaves com valor true" exige true em todas as chaves.
 * Linhas abreviadas (`a / _b : x`), valores que não são JSON e observações soltas
 * ficam como "não conferidas": aparecem no resumo, mas não reprovam o teste.
 *
 * Uso:
 *   node .github/scripts/testes-banco.mjs [supabase/tests/arquivo.sql ...]
 *   node .github/scripts/testes-banco.mjs --so-cabecalhos   (só lê os cabeçalhos, sem banco)
 * Variáveis:
 *   DB_URL  conexão (padrão: banco local do `supabase db start`, porta 54322)
 *   PSQL    executável do psql (padrão: psql)
 */
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFileSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const PASTA_TESTES = path.join(RAIZ, "supabase", "tests")
// Credenciais fixas e públicas do Supabase local (só existem dentro do runner).
const DB_URL_PADRAO = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const LIMITE_POR_TESTE_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Leitura da saída do psql
// ---------------------------------------------------------------------------

/** Primeiro erro da saída do psql (VERBOSITY=verbose): SQLSTATE e mensagem completa. */
export function extrairErro(saida) {
  const texto = saida.replace(/\r\n/g, "\n")
  const achado = /(?:^|\n|: )(?:ERROR|FATAL|PANIC):\s+(?:([0-9A-Z]{5}):\s)?/.exec(texto)
  if (!achado) return null
  let mensagem = texto.slice(achado.index + achado[0].length)
  const fim = mensagem.search(/\n(?:DETAIL|HINT|QUERY|CONTEXT|LOCATION|LINE \d+|psql:[^\n]*?):\s/)
  if (fim !== -1) mensagem = mensagem.slice(0, fim)
  return { sqlstate: achado[1] ?? null, mensagem: mensagem.trimEnd() }
}

/** O objeto JSON que o teste pôs na mensagem, depois de um prefixo opcional. */
export function extrairResultado(mensagem) {
  for (let i = mensagem.indexOf("{"); i !== -1; i = mensagem.indexOf("{", i + 1)) {
    try {
      const valor = JSON.parse(mensagem.slice(i))
      if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
        return { prefixo: mensagem.slice(0, i).trim(), resultado: valor }
      }
    } catch {
      // Não era o início do JSON; tenta a próxima chave.
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Leitura do "Resultado esperado" do cabeçalho
// ---------------------------------------------------------------------------

function fimDeString(texto, inicio) {
  for (let i = inicio + 1; i < texto.length; i++) {
    if (texto[i] === "\\") i++
    else if (texto[i] === '"') return i + 1
  }
  return -1
}

function fimDeBloco(texto) {
  let profundidade = 0
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '"') {
      const fim = fimDeString(texto, i)
      if (fim === -1) return -1
      i = fim - 1
    } else if (c === "{" || c === "[") profundidade++
    else if (c === "}" || c === "]") {
      profundidade--
      if (profundidade === 0) return i + 1
    }
  }
  return -1
}

/**
 * Valor em JSON no início do texto. Devolve também o que sobrou depois dele
 * (normalmente uma observação entre parênteses), ou null se não houver JSON.
 */
export function lerValorJson(texto) {
  const t = texto.trim()
  if (t === "") return null
  try {
    return { valor: JSON.parse(t), sobra: "" }
  } catch {
    // Pode haver observação depois do valor; tenta só o começo.
  }
  let fim = -1
  if (t[0] === '"') fim = fimDeString(t, 0)
  else if (t[0] === "{" || t[0] === "[") fim = fimDeBloco(t)
  else {
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.])/.exec(t)
    if (m) fim = m[0].length
  }
  if (fim <= 0) return null
  try {
    return { valor: JSON.parse(t.slice(0, fim)), sobra: t.slice(fim).trim() }
  } catch {
    return null
  }
}

// Sem `_?` antes da classe, que já aceita `_`: a ambiguidade causava backtracking exponencial.
const LINHA_CHAVE = /^([a-z0-9_]+(?:\s*\/\s*[a-z0-9_]+)*)\s*:\s?(.*)$/i

/**
 * Lê o bloco "Resultado esperado" dos comentários do topo do arquivo.
 * modo: "sem-cabecalho" | "todas-true" | "chaves"
 */
export function lerEsperado(sql) {
  const linhas = sql.replace(/\r\n/g, "\n").split("\n")
  const topo = []
  for (const linha of linhas) {
    if (linha.trim() === "" || /^\s*--/.test(linha)) topo.push(linha)
    else break
  }
  const inicio = topo.findIndex((l) => /resultado esperado/i.test(l))
  if (inicio === -1) return { modo: "sem-cabecalho", chaves: [], naoConferidas: [] }
  if (/todas as chaves com valor true/i.test(topo[inicio])) {
    return { modo: "todas-true", chaves: [], naoConferidas: [] }
  }

  // Linhas do bloco: comentários não vazios logo abaixo do título.
  const bloco = []
  for (const linha of topo.slice(inicio + 1)) {
    const conteudo = /^\s*--\s?(.*)$/.exec(linha)?.[1]
    if (conteudo === undefined || conteudo.trim() === "" || /^-{3,}/.test(conteudo.trim())) break
    bloco.push(conteudo.trim())
  }

  // Junta chaves agrupadas que continuam na linha de baixo (`a / b /` + `c : x`).
  const logicas = []
  for (const conteudo of bloco) {
    const anterior = logicas.at(-1)
    if (anterior !== undefined && anterior.endsWith("/"))
      logicas[logicas.length - 1] += ` ${conteudo}`
    else logicas.push(conteudo)
  }

  const chaves = []
  const naoConferidas = []
  for (const linha of logicas) {
    const m = LINHA_CHAVE.exec(linha)
    if (!m) {
      // Continuação de observação da linha anterior.
      continue
    }
    const nomes = m[1].split("/").map((n) => n.trim())
    if (nomes.some((n) => n.startsWith("_"))) {
      naoConferidas.push({ linha, motivo: "chaves abreviadas" })
      continue
    }
    const inteiro = lerValorJson(m[2])
    const partes = m[2].split(" / ").map((p) => lerValorJson(p))
    if (
      nomes.length > 1 &&
      partes.length === nomes.length &&
      partes.every((p) => p?.sobra === "")
    ) {
      nomes.forEach((nome, i) => chaves.push({ chave: nome, valor: partes[i].valor, linha }))
    } else if (inteiro !== null && (inteiro.sobra === "" || inteiro.sobra.startsWith("("))) {
      for (const nome of nomes) chaves.push({ chave: nome, valor: inteiro.valor, linha })
    } else {
      naoConferidas.push({ linha, motivo: "valor não é JSON" })
    }
  }
  return { modo: "chaves", chaves, naoConferidas }
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

export function iguais(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => iguais(v, b[i]))
  const ka = Object.keys(a)
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Object.hasOwn(b, k) && iguais(a[k], b[k]))
  )
}

/** Divergências entre o resultado do teste e o cabeçalho. */
export function comparar(resultado, esperado) {
  const divergencias = []
  if (esperado.modo === "todas-true") {
    for (const [chave, valor] of Object.entries(resultado)) {
      if (valor !== true) divergencias.push({ chave, esperado: true, obtido: valor })
    }
    return { divergencias, conferidas: Object.keys(resultado).length }
  }
  for (const { chave, valor } of esperado.chaves) {
    if (!Object.hasOwn(resultado, chave)) {
      divergencias.push({ chave, esperado: valor, obtido: "(chave ausente)" })
    } else if (!iguais(resultado[chave], valor)) {
      divergencias.push({ chave, esperado: valor, obtido: resultado[chave] })
    }
  }
  return { divergencias, conferidas: esperado.chaves.length }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** Classifica a execução de um arquivo. */
export function avaliar(execucao, sql) {
  if (execucao.error?.code === "ETIMEDOUT" || execucao.signal) {
    return { ok: false, motivo: `tempo esgotado (${LIMITE_POR_TESTE_MS / 60000} min)` }
  }
  if (execucao.status === 0) {
    return {
      ok: false,
      motivo: "terminou sem a exceção final: o teste não devolveu resultado nem desfez a transação",
    }
  }
  const saida = `${execucao.stderr ?? ""}\n${execucao.stdout ?? ""}`
  const erro = extrairErro(saida)
  if (erro === null)
    return { ok: false, motivo: "o psql falhou sem erro do Postgres", bruto: saida }
  const lido = extrairResultado(erro.mensagem)
  // Sem SQLSTATE na saída (psql sem VERBOSITY=verbose), vale o JSON na mensagem.
  if (erro.sqlstate !== "P0001" && !(erro.sqlstate === null && lido !== null)) {
    return {
      ok: false,
      motivo: `erro ${erro.sqlstate ?? "?"} antes do resultado`,
      bruto: erro.mensagem,
    }
  }
  if (lido === null) {
    return { ok: false, motivo: "exceção P0001 sem JSON de resultado", bruto: erro.mensagem }
  }
  const esperado = lerEsperado(sql)
  const { divergencias, conferidas } = comparar(lido.resultado, esperado)
  return {
    ok: divergencias.length === 0,
    motivo:
      divergencias.length === 0 ? "" : `${divergencias.length} chave(s) diferente(s) do cabeçalho`,
    modo: esperado.modo,
    conferidas,
    naoConferidas: esperado.naoConferidas,
    divergencias,
    bruto: divergencias.length === 0 ? undefined : erro.mensagem,
  }
}

function escaparComando(texto, propriedade = false) {
  let t = String(texto).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
  if (propriedade) t = t.replace(/:/g, "%3A").replace(/,/g, "%2C")
  return t
}

function escaparTabela(texto) {
  return String(texto).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

/** Imprime texto vindo do banco sem deixar o runner interpretar `::comandos::`. */
function imprimirBruto(texto) {
  const token = randomUUID()
  console.log(`::stop-commands::${token}`)
  console.log(texto)
  console.log(`::${token}::`)
}

function listarArquivos(argumentos) {
  if (argumentos.length > 0) return argumentos.map((a) => path.resolve(a))
  return readdirSync(PASTA_TESTES)
    .filter((nome) => nome.endsWith(".sql"))
    .sort()
    .map((nome) => path.join(PASTA_TESTES, nome))
}

function soCabecalhos(arquivos) {
  for (const arquivo of arquivos) {
    const sql = readFileSync(arquivo, "utf8")
    const esperado = lerEsperado(sql)
    const semLiteral = esperado.chaves.filter(({ chave }) => !sql.includes(`'${chave}'`))
    console.log(
      `${path.basename(arquivo)}: ${esperado.modo}, ${esperado.chaves.length} chave(s), ` +
        `${esperado.naoConferidas.length} linha(s) não conferida(s)` +
        (semLiteral.length > 0
          ? `, sem literal no SQL: ${semLiteral.map((c) => c.chave).join(", ")}`
          : "")
    )
    for (const { linha, motivo } of esperado.naoConferidas) console.log(`    [${motivo}] ${linha}`)
  }
}

function principal() {
  const argumentos = process.argv.slice(2)
  const apenasCabecalhos = argumentos.includes("--so-cabecalhos")
  const arquivos = listarArquivos(argumentos.filter((a) => !a.startsWith("--")))
  if (arquivos.length === 0) {
    console.log("::error::Nenhum teste .sql encontrado em supabase/tests.")
    return 1
  }
  if (apenasCabecalhos) {
    soCabecalhos(arquivos)
    return 0
  }

  const dbUrl = process.env.DB_URL || DB_URL_PADRAO
  const psql = process.env.PSQL || "psql"
  const linhasResumo = [
    "## Testes SQL (supabase/tests)",
    "",
    "| Teste | Resultado | Chaves conferidas | Não conferidas | Detalhe |",
    "| --- | --- | ---: | ---: | --- |",
  ]
  let falhas = 0

  for (const arquivo of arquivos) {
    const relativo = path.relative(RAIZ, arquivo).split(path.sep).join("/")
    const inicio = Date.now()
    const execucao = spawnSync(
      psql,
      [
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-v",
        "SHOW_CONTEXT=never",
        "-d",
        dbUrl,
        "-f",
        arquivo,
      ],
      {
        encoding: "utf8",
        timeout: LIMITE_POR_TESTE_MS,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PGCLIENTENCODING: "UTF8", PGAPPNAME: "testes-banco-ci" },
      }
    )
    if (execucao.error && execucao.error.code !== "ETIMEDOUT") {
      console.log(
        `::error::Não consegui executar o psql (${escaparComando(execucao.error.message)}).`
      )
      return 2
    }
    const avaliacao = avaliar(execucao, readFileSync(arquivo, "utf8"))
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1)
    const naoConferidas = avaliacao.naoConferidas?.length ?? 0
    const conferidas =
      avaliacao.modo === "sem-cabecalho" ? "sem cabeçalho" : String(avaliacao.conferidas ?? 0)

    if (avaliacao.ok) {
      console.log(`OK      ${relativo} (${segundos}s; ${conferidas} conferida(s))`)
      linhasResumo.push(`| \`${relativo}\` | OK | ${conferidas} | ${naoConferidas} | |`)
      continue
    }

    falhas++
    console.log(`FALHOU  ${relativo} (${segundos}s): ${avaliacao.motivo}`)
    console.log(
      `::error file=${escaparComando(relativo, true)},title=Teste SQL falhou::${escaparComando(avaliacao.motivo)}`
    )
    for (const d of avaliacao.divergencias ?? []) {
      console.log(
        `    ${d.chave}: esperado ${JSON.stringify(d.esperado)}, obtido ${JSON.stringify(d.obtido)}`
      )
    }
    if (avaliacao.bruto) imprimirBruto(avaliacao.bruto.split("\n").slice(0, 80).join("\n"))
    const detalhe = [
      avaliacao.motivo,
      ...(avaliacao.divergencias ?? []).map(
        (d) =>
          `${d.chave}: esperado ${JSON.stringify(d.esperado)}, obtido ${JSON.stringify(d.obtido)}`
      ),
    ].join("; ")
    linhasResumo.push(
      `| \`${relativo}\` | **FALHOU** | ${conferidas} | ${naoConferidas} | ${escaparTabela(detalhe).slice(0, 500)} |`
    )
  }

  linhasResumo.push(
    "",
    `${arquivos.length - falhas} de ${arquivos.length} teste(s) passaram.`,
    "",
    "Chaves não conferidas: linhas do cabeçalho abreviadas ou sem valor em JSON. Elas não reprovam o teste."
  )
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${linhasResumo.join("\n")}\n`)
  }
  console.log(`\n${arquivos.length - falhas} de ${arquivos.length} teste(s) passaram.`)
  return falhas === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal()
}
