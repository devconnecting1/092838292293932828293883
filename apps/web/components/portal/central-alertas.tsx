"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type LeadCentral = { id: string; nome: string | null; cidade: string | null; desde: string }
type LeadAtraso = {
  id: string
  nome: string | null
  parceiro: string | null
  parceiro_whats: string | null
  vencido_em: string
  ultimo_contato: string | null
}
type Painel = {
  leads_central: LeadCentral[]
  leads_central_atrasados: number
  leads_sem_retorno: LeadAtraso[]
  leads_aguardando_aceite: number
  chamados_abertos: number
  chamados_sem_resposta: number
  corretores_pendentes: number
  avulsos_pendentes: number
  publicidade_para_aprovar: number
  planos_aguardando_pagamento: number
  planos_pagos_sem_aprovacao: number
}

function ha(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} dias`
}

function whatsCobranca(tel: string | null, parceiro: string | null, cliente: string | null) {
  let n = (tel ?? "").replace(/\D/g, "")
  if (n.length === 10 || n.length === 11) n = `55${n}`
  if (!n) return null
  const msg = `Olá, ${(parceiro ?? "").split(" ")[0]}! O cliente ${cliente ?? ""} está sem retorno registrado no painel do Vamos Arrematar. Pode atualizar o atendimento hoje?`
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`
}

/** Fila do dia: o que está atrasado ou esperando decisão, com o atalho para resolver. */
export function CentralAlertas() {
  const [p, setP] = React.useState<Painel | null>(null)
  const [erro, setErro] = React.useState("")
  const [, setTique] = React.useState(0)

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data, error } = await sb.rpc("painel_alertas")
    if (error)
      setErro("A central de alertas aparece quando o banco estiver atualizado (parte 019).")
    else setP(data as Painel)
    setTique((t) => t + 1)
  }, [])
  React.useEffect(() => {
    const t = setTimeout(carregar, 0)
    const i = setInterval(carregar, 60_000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [carregar])

  if (erro) return <p className="text-sm text-slate-500">{erro}</p>
  if (!p) return <p className="text-slate-600">Carregando alertas...</p>

  const pendencias: [number, string, string][] = (
    [
      [p.leads_central_atrasados, "clientes parados na central", "/gestao/leads"],
      [p.leads_sem_retorno.length, "clientes sem retorno do parceiro", "#sem-retorno"],
      [p.leads_aguardando_aceite, "leads esperando o parceiro aceitar", "/gestao/leads"],
      [p.chamados_sem_resposta, "chamados sem resposta", "/gestao/chamados"],
      [p.corretores_pendentes, "corretores para aprovar", "/corretores/aprovar"],
      [
        p.avulsos_pendentes,
        "anúncios de proprietário para aprovar",
        "/corretores/aprovar-anuncios",
      ],
      [p.publicidade_para_aprovar, "publicidades pagas para aprovar", "/gestao/publicidade"],
      [
        p.planos_aguardando_pagamento,
        "planos de anúncio esperando pagamento",
        "/gestao/publicidade",
      ],
    ] as [number, string, string][]
  ).filter(([n]) => n > 0)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">Central de alertas</h2>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${pendencias.length ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {pendencias.length ? `${pendencias.length} frentes pedem ação` : "Tudo em dia"}
        </span>
      </div>
      {pendencias.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {pendencias.map(([n, t, h]) => (
            <Link
              key={t}
              href={h}
              className="rounded-xl border border-red-200 bg-red-50/50 p-3 hover:border-red-400"
            >
              <span className="text-2xl font-extrabold text-red-700">{n}</span>
              <span className="block text-sm font-bold">{t}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {p.leads_central.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-extrabold">Clientes esperando encaminhamento</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {p.leads_central.slice(0, 10).map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
              >
                <span>
                  <b>{l.nome ?? "Cliente"}</b>
                  {l.cidade ? ` · ${l.cidade}` : ""}
                </span>
                <span className="font-bold text-red-700">esperando há {ha(l.desde)}</span>
              </li>
            ))}
          </ul>
          <Link href="/gestao/leads" className="text-sm font-bold text-[var(--brand)]">
            Encaminhar agora
          </Link>
        </div>
      ) : null}

      {p.leads_sem_retorno.length ? (
        <div id="sem-retorno" className="flex flex-col gap-2">
          <h3 className="font-extrabold">Parceiros devendo retorno ao cliente</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {p.leads_sem_retorno.map((l) => {
              const w = whatsCobranca(l.parceiro_whats, l.parceiro, l.nome)
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <span>
                    <b>{l.nome ?? "Cliente"}</b> com {l.parceiro ?? "parceiro"} ·{" "}
                    {l.ultimo_contato
                      ? `último contato há ${ha(l.ultimo_contato)}`
                      : "nenhum contato registrado"}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold text-red-700">venceu há {ha(l.vencido_em)}</span>
                    {w ? (
                      <a
                        href={w}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white"
                      >
                        Cobrar no WhatsApp
                      </a>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-slate-500">
        Atualiza sozinho a cada minuto. Os prazos dos alertas ficam em Configurações (CEO).
      </p>
    </section>
  )
}
