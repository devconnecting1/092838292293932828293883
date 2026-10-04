"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type Filtros = {
  uf: string
  cidade: string
  tipo: string
  origem: string
  leiloeiro: string
  financiamento: boolean | null
  minDesconto: number | null
  maxPreco: number | null
}

const LIMITE = 5000
const LOTE = 1000

const COLUNAS: [string, string][] = [
  ["id", "Código"],
  ["origem", "Origem"],
  ["modalidade", "Modalidade"],
  ["tipo", "Tipo"],
  ["uf", "UF"],
  ["cidade", "Cidade"],
  ["bairro", "Bairro"],
  ["endereco", "Endereço"],
  ["preco", "Preço"],
  ["avaliacao", "Avaliação"],
  ["desconto", "Desconto (%)"],
  ["financiamento", "Aceita financiamento"],
  ["leiloeiro", "Leiloeiro"],
  ["data_leilao_1", "1º leilão"],
  ["data_leilao_2", "2º leilão"],
  ["data_encerramento", "Encerramento"],
]

function celula(v: unknown) {
  if (v === null || v === undefined) return ""
  if (typeof v === "boolean") return v ? "Sim" : "Não"
  if (typeof v === "number") return v.toLocaleString("pt-BR")
  const s = String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Planilha dos imóveis filtrados, liberada só para quem tem conta (grátis).
 * Sem login, leva para a tela de entrar e volta para cá depois.
 */
export function PlanilhaDownload({ filtros }: { filtros: Filtros }) {
  const router = useRouter()
  const [status, setStatus] = React.useState<"" | "gerando" | "erro">("")

  async function baixar() {
    const sb = portalBrowserClient()
    if (!sb) return setStatus("erro")
    const { data } = await sb.auth.getSession()
    if (!data.session) {
      const volta = window.location.pathname + window.location.search
      router.push(`/corretores/entrar?volta=${encodeURIComponent(volta)}`)
      return
    }
    setStatus("gerando")
    const linhas: Record<string, unknown>[] = []
    for (let de = 0; de < LIMITE; de += LOTE) {
      let q = sb.from("imoveis").select("*").eq("ativo", true)
      if (filtros.uf) q = q.eq("uf", filtros.uf)
      if (filtros.cidade) q = q.ilike("cidade", filtros.cidade)
      if (filtros.tipo) q = q.eq("tipo", filtros.tipo)
      if (filtros.origem) q = q.eq("origem", filtros.origem)
      if (filtros.leiloeiro) q = q.eq("leiloeiro", filtros.leiloeiro)
      if (filtros.financiamento != null) q = q.eq("financiamento", filtros.financiamento)
      if (filtros.minDesconto != null) q = q.gte("desconto", filtros.minDesconto)
      if (filtros.maxPreco != null) q = q.lte("preco", filtros.maxPreco)
      const { data: lote, error } = await q
        .order("desconto", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(de, de + LOTE - 1)
      if (error) return setStatus("erro")
      linhas.push(...(lote ?? []))
      if (!lote || lote.length < LOTE) break
    }
    const csv = [
      COLUNAS.map(([, t]) => t).join(";"),
      ...linhas.map((r) => COLUNAS.map(([c]) => celula(r[c])).join(";")),
    ].join("\r\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `imoveis-leilao${filtros.uf ? "-" + filtros.uf.toLowerCase() : ""}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setStatus("")
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={baixar}
        disabled={status === "gerando"}
        className="rounded-xl border-[1.5px] border-[var(--brand)] px-4 py-2 text-sm font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:opacity-50"
      >
        {status === "gerando" ? "Gerando planilha..." : "Baixar planilha"}
      </button>
      <span className="text-xs text-slate-500">
        {status === "erro" ? "Não foi possível gerar agora." : "Grátis para quem tem conta"}
      </span>
    </div>
  )
}
