"use client"

import * as React from "react"
import Link from "next/link"

import { ConsultaProcesso } from "@/components/portal/consulta-processo"
import { portalBrowserClient } from "@/lib/portal/browser-client"

async function token() {
  const sb = portalBrowserClient()
  return sb ? ((await sb.auth.getSession()).data.session?.access_token ?? null) : null
}

function Bloqueio({ erro }: { erro: string }) {
  return (
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      {erro}{" "}
      <Link href="/assinar" className="font-bold underline">
        Ver planos
      </Link>
    </p>
  )
}

type Envolvido = {
  numero: string
  poloAtivo: string | null
  poloPassivo: string | null
  inicio: string | null
  tribunais: string[]
  classe: string | null
}

const FINALIDADES = [
  "vendedor do imóvel",
  "ocupante do imóvel",
  "devedor do processo do leilão",
  "parte de negócio imobiliário",
]

export function BuscaCpf() {
  const [doc, setDoc] = React.useState("")
  const [finalidade, setFinalidade] = React.useState(FINALIDADES[0] as string)
  const [ciente, setCiente] = React.useState(false)
  const [res, setRes] = React.useState<Envolvido[] | null>(null)
  const [erro, setErro] = React.useState("")
  const [plano, setPlano] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    setErro("")
    setPlano(false)
    const t = await token()
    if (!t) return setErro("Entre na sua conta para usar a busca.")
    setBusy(true)
    try {
      const r = await fetch("/api/portal/envolvido", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ documento: doc, finalidade, ciente }),
      })
      const j = (await r.json()) as { erro?: string; processos?: Envolvido[] }
      if (!r.ok) {
        setErro(j.erro ?? "Não foi possível buscar.")
        setPlano(r.status === 402 || r.status === 429)
      } else setRes(j.processos ?? [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={buscar} className="grid gap-3 sm:grid-cols-2">
        <input
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          inputMode="numeric"
          placeholder="CPF ou CNPJ"
          className="h-11 rounded-lg border border-slate-300 px-3"
        />
        <select
          value={finalidade}
          onChange={(e) => setFinalidade(e.target.value)}
          className="h-11 rounded-lg border border-slate-300 bg-white px-2"
        >
          {FINALIDADES.map((f) => (
            <option key={f} value={f}>
              Quem é: {f}
            </option>
          ))}
        </select>
        <label className="block text-xs leading-relaxed text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={ciente}
            onChange={(e) => setCiente(e.target.checked)}
            className="mr-2 inline size-4 align-[-3px]"
          />
          Declaro que a consulta é para análise de um negócio imobiliário com essa pessoa ou
          empresa, que não vou divulgar o resultado e que a consulta fica registrada em meu nome
          (LGPD).
        </label>
        <button
          disabled={busy || !ciente}
          className="h-11 rounded-lg bg-[var(--brand)] font-bold text-white disabled:opacity-50 sm:col-span-2"
        >
          {busy ? "Buscando..." : "Buscar processos"}
        </button>
      </form>
      {erro ? (
        plano ? (
          <Bloqueio erro={erro} />
        ) : (
          <p className="text-sm font-bold text-red-700">{erro}</p>
        )
      ) : null}
      {res && res.length === 0 ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          Nenhum processo encontrado para esse documento na base consultada.
        </p>
      ) : null}
      {res && res.length ? (
        <ul className="flex flex-col gap-2">
          {res.map((p) => (
            <li key={p.numero} className="rounded-xl border border-slate-200 p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <b>{p.numero}</b>
                <span className="text-slate-500">{p.tribunais.join(", ")}</span>
              </div>
              <p className="text-slate-700">
                {p.poloAtivo ?? "?"} <span className="text-slate-400">x</span>{" "}
                {p.poloPassivo ?? "?"}
              </p>
              <p className="text-slate-500">
                {p.classe ?? ""}{" "}
                {p.inicio ? `· início ${new Date(p.inicio).toLocaleDateString("pt-BR")}` : ""}
              </p>
              <Link
                href={`/processos?numero=${p.numero.replace(/\D/g, "")}`}
                className="font-bold text-[var(--brand)]"
              >
                Ver andamento
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type Leitura = {
  paginas: number
  temTexto: boolean
  achados: {
    termo: string
    gravidade: string
    categoria: string
    trecho: string
    cancelado: boolean
  }[]
  ia: {
    resumo: string
    pendencias: { tipo: string; gravidade: string; trecho: string; explicacao: string }[]
    faltando: string[]
    conclusao: string
  } | null
}

const COR: Record<string, string> = {
  alta: "border-red-200 bg-red-50",
  media: "border-amber-200 bg-amber-50",
  baixa: "border-slate-200 bg-slate-50",
  info: "border-slate-200 bg-slate-50",
}

export function LeitorCertidoes() {
  const [res, setRes] = React.useState<Leitura | null>(null)
  const [erro, setErro] = React.useState("")
  const [plano, setPlano] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function enviar(fd: FormData) {
    setErro("")
    setRes(null)
    setPlano(false)
    const t = await token()
    if (!t) return setErro("Entre na sua conta para usar o leitor.")
    setBusy(true)
    try {
      const r = await fetch("/api/portal/certidoes", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}` },
        body: fd,
      })
      const j = (await r.json()) as Leitura & { erro?: string }
      if (!r.ok) {
        setErro(j.erro ?? "Não foi possível ler.")
        setPlano(r.status === 402 || r.status === 429)
      } else setRes(j)
    } finally {
      setBusy(false)
    }
  }

  const ativos = res?.achados.filter((a) => !a.cancelado && a.gravidade !== "info") ?? []

  return (
    <div className="flex flex-col gap-4">
      <form action={enviar} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="file"
          name="arquivo"
          accept="application/pdf"
          required
          className="flex-1 rounded-lg border border-slate-300 p-2 text-sm"
        />
        <button
          disabled={busy}
          className="h-11 rounded-lg bg-[var(--brand)] px-5 font-bold text-white disabled:opacity-50"
        >
          {busy ? "Lendo o PDF..." : "Ler certidão"}
        </button>
      </form>
      <p className="text-xs text-slate-500">
        Matrícula, ônus reais, certidões de débito ou de distribuidores. O arquivo é lido e
        descartado, não fica guardado.
      </p>
      {erro ? (
        plano ? (
          <Bloqueio erro={erro} />
        ) : (
          <p className="text-sm font-bold text-red-700">{erro}</p>
        )
      ) : null}
      {res ? (
        <div className="flex flex-col gap-4">
          <div
            className={`rounded-2xl border p-4 ${ativos.length || res.ia?.pendencias.length ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}
          >
            <b>
              {res.ia?.conclusao ||
                (ativos.length
                  ? `${ativos.length} ponto(s) de atenção encontrado(s) no texto.`
                  : res.temTexto
                    ? "Nenhum termo de pendência encontrado no texto lido."
                    : "O PDF parece escaneado (sem texto). Ative a leitura com IA para ler imagem.")}
            </b>
            {res.ia?.resumo ? <p className="mt-1 text-sm">{res.ia.resumo}</p> : null}
          </div>
          {res.ia?.pendencias.length ? (
            <ul className="flex flex-col gap-2">
              {res.ia.pendencias.map((p, i) => (
                <li
                  key={i}
                  className={`rounded-xl border p-3 text-sm ${COR[p.gravidade] ?? COR.media}`}
                >
                  <b>{p.tipo}</b> · gravidade {p.gravidade}
                  <p className="mt-1">{p.explicacao}</p>
                  <p className="mt-1 text-xs text-slate-600">&ldquo;{p.trecho}&rdquo;</p>
                </li>
              ))}
            </ul>
          ) : null}
          {res.achados.length ? (
            <details open={!res.ia}>
              <summary className="cursor-pointer text-sm font-bold">
                Termos encontrados no texto ({res.achados.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {res.achados.map((a, i) => (
                  <li key={i} className={`rounded-xl border p-3 text-sm ${COR[a.gravidade]}`}>
                    <b>{a.termo}</b> · {a.categoria}
                    {a.cancelado ? (
                      <span className="ml-2 rounded bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
                        aparece cancelado, confira
                      </span>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-600">&hellip;{a.trecho}&hellip;</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {res.ia?.faltando.length ? (
            <p className="text-sm">
              <b>Para concluir, peça também:</b> {res.ia.faltando.join("; ")}.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Leitura automática de apoio, feita por regras e, quando ativada, por inteligência
            artificial. Não substitui a análise de um profissional nem é parecer jurídico.
          </p>
        </div>
      ) : null}
    </div>
  )
}

const ABAS = [
  ["numero", "Processo pelo número"],
  ["cpf", "Processos por CPF/CNPJ"],
  ["certidao", "Leitor de certidões"],
] as const

export function FerramentasPagas({ numeroInicial = "" }: { numeroInicial?: string }) {
  const [aba, setAba] = React.useState<(typeof ABAS)[number][0]>("numero")
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {ABAS.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setAba(v)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${aba === v ? "bg-[var(--brand)] text-white" : "border border-slate-300"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {aba === "numero" ? <ConsultaProcesso numeroInicial={numeroInicial} /> : null}
      {aba === "cpf" ? <BuscaCpf /> : null}
      {aba === "certidao" ? <LeitorCertidoes /> : null}
    </div>
  )
}
