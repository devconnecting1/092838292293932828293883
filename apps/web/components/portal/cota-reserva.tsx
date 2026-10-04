"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

const campo = "h-11 rounded-lg border border-slate-300 px-3"

export function CotaProgresso({ reservadas }: { reservadas: number }) {
  const pct = Math.min(100, reservadas * 10)
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-3 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold text-slate-700">
        {pct}% reservado · faltam {100 - pct}%
      </span>
    </div>
  )
}

export function CotaCompartilhar({ titulo }: { titulo: string }) {
  const [copiado, setCopiado] = React.useState(false)
  function url() {
    return window.location.origin + window.location.pathname
  }
  function whatsapp() {
    const texto = `Bora fechar a cota desse imóvel comigo? ${titulo}. Cada cota é 10%. ${url()}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener")
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url())
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={whatsapp}
        className="rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white"
      >
        Chamar amigos no WhatsApp
      </button>
      <button
        type="button"
        onClick={copiar}
        className="rounded-lg border border-slate-300 py-2.5 text-sm font-bold"
      >
        {copiado ? "Link copiado" : "Copiar link"}
      </button>
    </div>
  )
}

/**
 * Reserva de cotas. Grava em `cotas_reservas`; se a tabela ainda não existir,
 * o pedido entra como lead para a equipe não perder o contato.
 */
export function CotaReserva({
  imovelId,
  titulo,
  valorCota,
  restantes,
}: {
  imovelId: string
  titulo: string
  valorCota: number
  restantes: number
}) {
  const [cotas, setCotas] = React.useState(1)
  const [status, setStatus] = React.useState<"" | "enviando" | "ok" | "erro">("")
  const [erro, setErro] = React.useState("")

  if (restantes <= 0) {
    return (
      <p className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
        As cotas deste imóvel já fecharam. Veja outros imóveis sugeridos abaixo.
      </p>
    )
  }

  async function enviar(fd: FormData) {
    setErro("")
    const sb = portalBrowserClient()
    if (!sb) return setStatus("erro")
    setStatus("enviando")
    const nome = String(fd.get("nome") ?? "").trim()
    const telefone = String(fd.get("telefone") ?? "").trim()
    const email = String(fd.get("email") ?? "").trim() || null
    const titular = fd.get("titular") === "on"
    const { error } = await sb.from("cotas_reservas").insert({
      imovel_id: imovelId,
      nome,
      telefone,
      email,
      cotas,
      quer_ser_titular: titular,
      consentimento: true,
    })
    if (!error) return setStatus("ok")
    if (/Restam/.test(error.message)) {
      setStatus("")
      return setErro(error.message)
    }
    const lead = await sb.from("leads").insert({
      imovel_id: imovelId,
      nome,
      telefone,
      email,
      interesse: "assessoria",
      mensagem: `Arremate em cotas: ${cotas} cota(s), ${cotas * 10}%, cerca de ${brl(cotas * valorCota)}. ${titulo}.${titular ? " Aceita ficar como titular." : ""}`,
      consentimento: true,
      origem: "cotas",
      status: "novo",
    })
    setStatus(lead.error ? "erro" : "ok")
  }

  if (status === "ok") {
    return (
      <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
        Reserva recebida. A equipe confirma pelo WhatsApp e te coloca no grupo de cotas. Chame
        amigos e parentes para fechar os 100% mais rápido.
      </p>
    )
  }

  return (
    <form action={enviar} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-bold">
        Quantas cotas você quer
        <select
          value={cotas}
          onChange={(e) => setCotas(Number(e.target.value))}
          className={`${campo} bg-white font-normal`}
        >
          {Array.from({ length: restantes }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} cota{n > 1 ? "s" : ""} ({n * 10}%) · {brl(n * valorCota)}
            </option>
          ))}
        </select>
      </label>
      <input name="nome" required minLength={3} placeholder="Nome completo" className={campo} />
      <input
        name="telefone"
        required
        inputMode="tel"
        placeholder="WhatsApp com DDD"
        className={campo}
      />
      <input name="email" type="email" placeholder="E-mail (opcional)" className={campo} />
      <label className="block text-sm text-slate-700">
        <input type="checkbox" name="titular" className="mr-2 inline size-4 align-[-3px]" />
        Aceito ficar como titular do imóvel nesta rodada
      </label>
      <label className="block text-xs leading-relaxed text-slate-700">
        <input type="checkbox" required className="mr-2 inline size-4 align-[-3px]" />
        Entendo que é uma reserva de interesse, sem pagamento agora, que o arremate só acontece se
        as cotas fecharem 100% e que o retorno não é garantido. Autorizo o contato conforme a{" "}
        <Link href="/privacidade" className="font-bold underline">
          Política de Privacidade
        </Link>
        .
      </label>
      {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
      {status === "erro" ? (
        <p className="text-sm font-bold text-red-700">Não foi possível enviar. Tente de novo.</p>
      ) : null}
      <button
        disabled={status === "enviando"}
        className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
      >
        {status === "enviando" ? "Enviando..." : `Reservar ${cotas * 10}%`}
      </button>
    </form>
  )
}
