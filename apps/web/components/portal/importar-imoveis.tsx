"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"
import { getSupabaseEnv } from "@/lib/supabase/env"

type Log = {
  id: number
  uf: string | null
  fonte: string
  inicio: string
  lidos: number | null
  novos: number | null
  removidos: number | null
  erro: string | null
}

const UFS = new Set(
  "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ")
)

/** Estado (UF) de uma lista da Caixa, pela 2ª coluna das linhas de imóvel. */
function ufDaLista(texto: string) {
  for (const l of texto.split(/\r?\n/)) {
    const c = l.split(";")
    const num = c[0] ?? ""
    const uf = (c[1] ?? "").trim()
    if (c.length > 10 && /^\s*\d{6,}\s*$/.test(num) && UFS.has(uf)) return uf
  }
  return null
}

export function ImportarImoveis() {
  const [admin, setAdmin] = React.useState<boolean | null>(null)
  const [logs, setLogs] = React.useState<Log[]>([])
  const [saida, setSaida] = React.useState<string[]>([])
  const [ocupado, setOcupado] = React.useState(false)

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: a } = await sb.rpc("sou_admin")
    setAdmin(a === true)
    if (a !== true) return
    const { data } = await sb
      .from("importacoes")
      .select("*")
      .order("id", { ascending: false })
      .limit(30)
    setLogs((data ?? []) as Log[])
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => void carregar(), 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function chamar(funcao: string, corpo: unknown) {
    const sb = portalBrowserClient()
    const env = getSupabaseEnv()
    if (!sb || !env) throw new Error("Serviço indisponível.")
    const { data: s } = await sb.auth.getSession()
    const r = await fetch(`${env.url}/functions/v1/${funcao}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.publishableKey,
        Authorization: `Bearer ${s.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(corpo),
    })
    return r.json().catch(() => ({ erro: `resposta ${r.status}` }))
  }

  async function enviarCaixa(fd: FormData) {
    const arquivos = fd.getAll("listas").filter((f): f is File => f instanceof File && f.size > 0)
    if (!arquivos.length) return
    setOcupado(true)
    const linhas: string[] = []
    for (const f of arquivos) {
      const texto = new TextDecoder("windows-1252").decode(await f.arrayBuffer())
      const uf = ufDaLista(texto)
      if (!uf) {
        linhas.push(
          `${f.name}: não parece a lista da Caixa (baixe o CSV do estado no site da Caixa).`
        )
        continue
      }
      const r = await chamar("importar-caixa", { ufs: [uf], csv: texto })
      const res = Array.isArray(r?.resultado) ? r.resultado[0] : r
      linhas.push(
        res?.erro
          ? `${uf}: erro, ${res.erro}`
          : `${uf}: ${res?.lidos ?? 0} imóveis, ${res?.novos ?? 0} novos, ${res?.alterados ?? 0} mudaram, ${res?.removidos ?? 0} saíram`
      )
      setSaida([...linhas])
    }
    setSaida(linhas)
    setOcupado(false)
    await carregar()
  }

  async function enviarParceiro(fd: FormData) {
    const f = fd.get("arquivo")
    const fonte = String(fd.get("fonte") ?? "")
      .trim()
      .toLowerCase()
    if (!(f instanceof File) || !f.size || !/^[a-z0-9_]{3,30}$/.test(fonte)) return
    setOcupado(true)
    const texto = await f.text()
    const corpo = texto.trim().startsWith("[")
      ? { fonte, completo: fd.get("completo") === "on", itens: JSON.parse(texto) }
      : { fonte, completo: fd.get("completo") === "on", csv: texto }
    const r = await chamar("importar-feed", corpo)
    setSaida([
      r?.ok
        ? `${fonte}: ${r.validos} válidos de ${r.lidos}, ${r.novos} novos, ${r.alterados} mudaram, ${r.enriquecidos} imóveis da Caixa completados, ${r.removidos} saíram`
        : `${fonte}: erro, ${r?.erro ?? "desconhecido"}`,
    ])
    setOcupado(false)
    await carregar()
  }

  if (admin === null) return <p className="text-slate-600">Carregando...</p>
  if (!admin)
    return (
      <p className="rounded-2xl border border-slate-200 p-6">
        Área restrita.{" "}
        <Link href="/corretores/entrar" className="font-bold text-[var(--brand)]">
          Entrar
        </Link>
      </p>
    )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Administração
        </span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Atualizar imóveis</h1>
        <p className="mt-1 leading-relaxed text-slate-600">
          O sistema tenta atualizar sozinho a cada hora. Quando a Caixa bloqueia o robô, use esta
          tela: baixe as listas no site da Caixa e solte os arquivos aqui. O que é novo entra, o que
          mudou de preço é atualizado e o que saiu da lista sai do portal.
        </p>
      </div>

      <form
        action={enviarCaixa}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5"
      >
        <h2 className="text-lg font-extrabold">Listas da Caixa (CSV por estado)</h2>
        <a
          href="https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold text-[var(--brand)]"
        >
          Abrir a página de download da Caixa
        </a>
        <input name="listas" type="file" multiple accept=".csv,text/csv" className="text-sm" />
        <button
          disabled={ocupado}
          className="h-11 self-start rounded-xl bg-[var(--brand)] px-6 font-bold text-white disabled:opacity-50"
        >
          {ocupado ? "Processando..." : "Atualizar"}
        </button>
      </form>

      <form
        action={enviarParceiro}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5"
      >
        <h2 className="text-lg font-extrabold">Arquivo de parceiro (outros bancos e judiciais)</h2>
        <input
          name="fonte"
          required
          placeholder="Nome da fonte, ex.: leilaoimovel"
          className="h-11 rounded-lg border border-slate-300 px-3"
        />
        <input
          name="arquivo"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="completo" defaultChecked className="size-4" />
          Lista completa (o que não vier no arquivo sai do portal)
        </label>
        <button
          disabled={ocupado}
          className="h-11 self-start rounded-xl bg-[var(--brand)] px-6 font-bold text-white disabled:opacity-50"
        >
          Importar
        </button>
      </form>

      {saida.length ? (
        <ul className="rounded-2xl bg-slate-50 p-4 text-sm">
          {saida.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-extrabold">Últimas atualizações</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Quando</th>
              <th>Fonte</th>
              <th>Estado</th>
              <th className="text-right">Lidos</th>
              <th className="text-right">Novos</th>
              <th className="text-right">Saíram</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1.5">{new Date(l.inicio).toLocaleString("pt-BR")}</td>
                <td>{l.fonte === "caixa_lista" ? "Caixa" : l.fonte}</td>
                <td>{l.uf ?? "Todos"}</td>
                <td className="text-right">{l.lidos ?? 0}</td>
                <td className="text-right">{l.novos ?? 0}</td>
                <td className="text-right">{l.removidos ?? 0}</td>
                <td className={l.erro ? "text-red-700" : "text-emerald-700"}>{l.erro ?? "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
