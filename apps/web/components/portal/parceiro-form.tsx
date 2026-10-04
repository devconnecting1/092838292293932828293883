"use client"

import * as React from "react"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { portalBrowserClient } from "@/lib/portal/browser-client"

const campo = "h-11 rounded-lg border border-slate-300 px-3"

export const CATEGORIAS = [
  "Advogado correspondente",
  "Despachante e documentação",
  "Engenheiro ou arquiteto (vistoria e laudo)",
  "Avaliador imobiliário",
  "Leiloeiro",
  "Imobiliária parceira",
  "Correspondente bancário",
  "Reforma e manutenção",
  "Outro",
]

/** Cadastro de parceiros e correspondentes: chega para o dono avaliar. */
export function ParceiroForm() {
  const [status, setStatus] = React.useState<"" | "enviando" | "ok" | "erro">("")
  async function enviar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return setStatus("erro")
    setStatus("enviando")
    const linha = {
      nome: String(fd.get("nome") ?? "").trim(),
      empresa: String(fd.get("empresa") ?? "").trim() || null,
      categoria: String(fd.get("categoria") ?? "Outro"),
      registro: String(fd.get("registro") ?? "").trim() || null,
      telefone: String(fd.get("telefone") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim() || null,
      cidade: String(fd.get("cidade") ?? "").trim() || null,
      uf: String(fd.get("uf") ?? "") || null,
      mensagem: String(fd.get("mensagem") ?? "").trim() || null,
      consentimento: true,
    }
    let { error } = await sb.from("parceiros").insert(linha)
    if (error) {
      // Banco ainda sem a tabela de parceiros: o pedido entra como contato para não se perder.
      ;({ error } = await sb.from("leads").insert({
        nome: linha.nome,
        telefone: linha.telefone,
        email: linha.email,
        interesse: "duvida",
        mensagem: `Parceria: ${linha.categoria}${linha.empresa ? `, ${linha.empresa}` : ""}${linha.registro ? `, registro ${linha.registro}` : ""}. ${linha.cidade ?? ""}/${linha.uf ?? ""}. ${linha.mensagem ?? ""}`,
        consentimento: true,
        origem: "parceiros",
        status: "novo",
      }))
    }
    setStatus(error ? "erro" : "ok")
  }
  if (status === "ok")
    return (
      <p className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
        Recebemos o seu cadastro. A nossa equipe avalia e entra em contato pelo WhatsApp.
      </p>
    )
  return (
    <form
      action={enviar}
      className="grid gap-3 rounded-2xl border border-slate-200 p-5 sm:grid-cols-2"
    >
      <input name="nome" required minLength={3} placeholder="Seu nome" className={campo} />
      <input name="empresa" placeholder="Empresa ou escritório (opcional)" className={campo} />
      <select name="categoria" required className={`${campo} bg-white`} defaultValue="">
        <option value="" disabled>
          Área de atuação
        </option>
        {CATEGORIAS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <input
        name="registro"
        placeholder="Registro profissional (OAB, CREA, CRECI...)"
        className={campo}
      />
      <input
        name="telefone"
        required
        inputMode="tel"
        placeholder="WhatsApp com DDD"
        className={campo}
      />
      <input name="email" type="email" placeholder="E-mail" className={campo} />
      <input name="cidade" placeholder="Cidade onde atende" className={campo} />
      <select name="uf" defaultValue="RJ" className={`${campo} bg-white`}>
        {BRAZILIAN_STATES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      <textarea
        name="mensagem"
        rows={3}
        placeholder="Conte como você quer trabalhar com a gente"
        className="rounded-lg border border-slate-300 p-3 sm:col-span-2"
      />
      <label className="block text-xs leading-relaxed text-slate-700 sm:col-span-2">
        <input type="checkbox" required className="mr-2 inline size-4 align-[-3px]" />
        Autorizo o contato e o uso destes dados para avaliar a parceria, conforme a{" "}
        <Link href="/privacidade" className="font-bold underline">
          Política de Privacidade
        </Link>
        .
      </label>
      {status === "erro" ? (
        <p className="text-sm font-bold text-red-700 sm:col-span-2">
          Não foi possível enviar. Tente de novo.
        </p>
      ) : null}
      <button
        disabled={status === "enviando"}
        className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50 sm:col-span-2"
      >
        {status === "enviando" ? "Enviando..." : "Quero ser parceiro"}
      </button>
    </form>
  )
}
