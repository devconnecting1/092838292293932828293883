"use client"

import * as React from "react"
import Link from "next/link"

import { portalBrowserClient } from "@/lib/portal/browser-client"

/**
 * Pedido de assessoria para um imóvel do portal: entra como pedido do serviço
 * "assessoria-leilao" e a equipe envia o orçamento e o link de pagamento.
 */
export function AssessoriaForm({ imovelId, titulo }: { imovelId: string; titulo: string }) {
  const [aberto, setAberto] = React.useState(false)
  const [status, setStatus] = React.useState<"" | "enviando" | "ok" | "erro">("")

  async function enviar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return setStatus("erro")
    setStatus("enviando")
    const { error } = await sb.from("pedidos").insert({
      servico_id: "assessoria-leilao",
      imovel_id: imovelId,
      nome: String(fd.get("nome") ?? "").trim(),
      telefone: String(fd.get("telefone") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim() || null,
      observacao: String(fd.get("observacao") ?? "").trim() || null,
      consentimento: fd.get("consentimento") === "on",
      status: "novo",
    })
    setStatus(error ? "erro" : "ok")
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-xl bg-[var(--brand)] py-3.5 text-center font-bold text-white"
      >
        Quero assessoria para este imóvel
      </button>
    )
  }

  if (status === "ok") {
    return (
      <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">
        Pedido recebido. A nossa equipe analisa o imóvel e envia o orçamento e o link de pagamento
        pelo WhatsApp.
      </p>
    )
  }

  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4">
      <span className="text-sm font-extrabold">Assessoria para: {titulo}</span>
      <input
        name="nome"
        required
        minLength={3}
        placeholder="Seu nome"
        className="h-11 rounded-lg border border-slate-300 px-3"
      />
      <input
        name="telefone"
        required
        inputMode="tel"
        placeholder="WhatsApp com DDD"
        className="h-11 rounded-lg border border-slate-300 px-3"
      />
      <input
        name="email"
        type="email"
        placeholder="E-mail (opcional)"
        className="h-11 rounded-lg border border-slate-300 px-3"
      />
      <textarea
        name="observacao"
        rows={2}
        placeholder="Conte o que você precisa (opcional)"
        className="rounded-lg border border-slate-300 p-3 text-sm"
      />
      <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-700">
        <input type="checkbox" name="consentimento" required className="mt-0.5 size-4" />
        Autorizo o contato e o uso dos meus dados para este pedido, conforme a{" "}
        <Link href="/privacidade" className="font-bold underline">
          Política de Privacidade
        </Link>
        .
      </label>
      {status === "erro" ? (
        <p className="text-sm font-bold text-red-700">Não foi possível enviar. Tente de novo.</p>
      ) : null}
      <button
        disabled={status === "enviando"}
        className="h-11 rounded-lg bg-[var(--brand)] font-bold text-white disabled:opacity-50"
      >
        {status === "enviando" ? "Enviando..." : "Pedir orçamento da assessoria"}
      </button>
    </form>
  )
}
