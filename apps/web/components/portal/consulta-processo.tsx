"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type Movimento = { data: string; nome: string; complemento: string | null }
type Processo = {
  numero: string
  tribunal: string
  classe: string | null
  sistema: string | null
  grau: string | null
  orgao: string | null
  ajuizamento: string | null
  atualizado: string | null
  assuntos: string[]
  movimentos: Movimento[]
}

const TRIBUNAIS = [
  ["", "Descobrir pelo número"],
  ...[
    "ac",
    "al",
    "am",
    "ap",
    "ba",
    "ce",
    "dft",
    "es",
    "go",
    "ma",
    "mg",
    "ms",
    "mt",
    "pa",
    "pb",
    "pe",
    "pi",
    "pr",
    "rj",
    "rn",
    "ro",
    "rr",
    "rs",
    "sc",
    "se",
    "sp",
    "to",
  ].map((u) => [`tj${u}`, `TJ${u.toUpperCase()}`]),
  ...[1, 2, 3, 4, 5, 6].map((n) => [`trf${n}`, `TRF da ${n}ª Região`]),
  ...Array.from({ length: 24 }, (_, i) => [`trt${i + 1}`, `TRT da ${i + 1}ª Região`]),
  ["stj", "STJ"],
  ["tst", "TST"],
] as [string, string][]

function data(v: string | null) {
  if (!v) return "-"
  const d = new Date(v.length === 14 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("pt-BR")
}

/** Consulta de andamento processual (Datajud/CNJ), só para quem tem conta. */
export function ConsultaProcesso({ numeroInicial = "" }: { numeroInicial?: string }) {
  const [numero, setNumero] = React.useState(numeroInicial)
  const [tribunal, setTribunal] = React.useState("")
  const [estado, setEstado] = React.useState<"" | "buscando" | "login">("")
  const [erro, setErro] = React.useState("")
  const [aviso, setAviso] = React.useState("")
  const [res, setRes] = React.useState<Processo[] | null>(null)

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault()
    setErro("")
    setAviso("")
    const sb = portalBrowserClient()
    const sessao = sb ? (await sb.auth.getSession()).data.session : null
    if (!sessao) return setEstado("login")
    setEstado("buscando")
    try {
      const r = await fetch("/api/portal/processos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessao.access_token}`,
        },
        body: JSON.stringify({ numero, tribunal: tribunal || undefined }),
      })
      const j = (await r.json()) as { erro?: string; processos?: Processo[]; dvConfere?: boolean }
      if (!r.ok) setErro(j.erro ?? "Não foi possível consultar.")
      else {
        setRes(j.processos ?? [])
        if (j.dvConfere === false)
          setAviso("O dígito verificador do número não confere. Confira se foi digitado certo.")
      }
    } catch {
      setErro("Sem conexão com a consulta agora.")
    } finally {
      setEstado((s) => (s === "buscando" ? "" : s))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={buscar} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <input
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          inputMode="numeric"
          placeholder="Número do processo (padrão CNJ)"
          className="h-11 rounded-lg border border-slate-300 px-3"
        />
        <select
          value={tribunal}
          onChange={(e) => setTribunal(e.target.value)}
          className="h-11 rounded-lg border border-slate-300 bg-white px-2"
        >
          {TRIBUNAIS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          disabled={estado === "buscando"}
          className="h-11 rounded-lg bg-[var(--brand)] px-5 font-bold text-white disabled:opacity-50"
        >
          {estado === "buscando" ? "Consultando..." : "Consultar"}
        </button>
      </form>
      {estado === "login" ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          A consulta processual é para quem tem conta.{" "}
          <Link href="/corretores/entrar" className="font-bold underline">
            Entrar
          </Link>{" "}
          ou{" "}
          <Link href="/corretores/cadastro" className="font-bold underline">
            criar conta grátis
          </Link>
          .
        </p>
      ) : null}
      {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
      {aviso ? <p className="text-sm text-amber-800">{aviso}</p> : null}
      {res && res.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          Nenhum processo público encontrado com esse número nesse tribunal. Processos em segredo de
          justiça não aparecem na consulta pública.
        </p>
      ) : null}
      {res?.map((p, i) => (
        <article key={i} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-extrabold">{p.numero}</span>
            <span className="text-sm font-bold text-slate-500">
              {p.tribunal} · {p.grau ?? ""} · {p.sistema ?? ""}
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline text-slate-500">Classe: </dt>
              <dd className="inline font-bold">{p.classe ?? "-"}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Órgão julgador: </dt>
              <dd className="inline font-bold">{p.orgao ?? "-"}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Ajuizamento: </dt>
              <dd className="inline font-bold">{data(p.ajuizamento)}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Atualizado no CNJ: </dt>
              <dd className="inline font-bold">{data(p.atualizado)}</dd>
            </div>
            {p.assuntos.length ? (
              <div className="sm:col-span-2">
                <dt className="inline text-slate-500">Assuntos: </dt>
                <dd className="inline font-bold">{p.assuntos.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          <details open={i === 0}>
            <summary className="cursor-pointer text-sm font-bold">
              Movimentações ({p.movimentos.length})
            </summary>
            <ol className="mt-2 flex flex-col gap-1.5 text-sm">
              {p.movimentos.map((m, k) => (
                <li
                  key={k}
                  className="grid grid-cols-[90px_1fr] gap-2 border-b border-slate-100 pb-1.5"
                >
                  <span className="text-slate-500 tabular-nums">{data(m.data)}</span>
                  <span>
                    <b>{m.nome}</b>
                    {m.complemento ? (
                      <span className="text-slate-600"> · {m.complemento}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </article>
      ))}
      <p className="text-xs text-slate-500">
        Dados da API Pública do Datajud (CNJ): metadados de processos públicos, sem nomes das
        partes. A informação pode ter atraso em relação ao sistema do tribunal.
      </p>
    </div>
  )
}
