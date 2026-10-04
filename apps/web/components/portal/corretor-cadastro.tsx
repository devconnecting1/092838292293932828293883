"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { LgpdAceite, lerTelefones, TelefonesCampos } from "@/components/portal/campos-cadastro"
import { portalBrowserClient } from "@/lib/portal/browser-client"

const campo = "h-11 rounded-lg border border-slate-300 px-3"

export function CorretorCadastro({ modo }: { modo: "cadastro" | "entrar" }) {
  const router = useRouter()
  const [erro, setErro] = React.useState("")
  const [aviso, setAviso] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const [tipo, setTipo] = React.useState<
    "corretor" | "imobiliaria" | "investidor" | "comprador" | "proprietario"
  >("corretor")

  async function enviar(fd: FormData) {
    setErro("")
    setAviso("")
    const sb = portalBrowserClient()
    if (!sb) return setErro("Serviço indisponível no momento.")
    const email = String(fd.get("email") ?? "")
      .trim()
      .toLowerCase()
    const senha = String(fd.get("senha") ?? "")
    setEnviando(true)
    try {
      if (modo === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha })
        if (error) return setErro("E-mail ou senha incorretos, ou e-mail ainda não confirmado.")
        const volta = new URLSearchParams(window.location.search).get("volta") ?? ""
        router.push(/^\/(?!\/)[\w\-/?=&%.]*$/.test(volta) ? volta : "/minha-conta")
        return
      }
      if (senha.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.")
      const nome = String(fd.get("nome") ?? "").trim()
      const { data, error } = await sb.auth.signUp({
        email,
        password: senha,
        options: {
          data: { nome, tipo, ...lerTelefones(fd), lgpd_aceite_em: new Date().toISOString() },
          emailRedirectTo: `${window.location.origin}/corretores/entrar`,
        },
      })
      if (error) return setErro("Não foi possível criar a conta. Confira o e-mail ou tente outro.")
      if (data.session && data.user) {
        await sb.from("perfis").upsert({
          user_id: data.user.id,
          nome,
          email,
          perfil: tipo,
          creci:
            tipo === "corretor" || tipo === "imobiliaria"
              ? String(fd.get("creci") ?? "").trim()
              : null,
          creci_uf:
            tipo === "corretor" || tipo === "imobiliaria" ? String(fd.get("creci_uf") ?? "") : null,
          ...lerTelefones(fd),
          lgpd_aceite_em: new Date().toISOString(),
          creci_ok: false,
        })
        router.push("/minha-conta")
        return
      }
      setAviso(
        "Conta criada. Enviamos um link de confirmação para o seu e-mail. Confirme e depois entre para enviar a foto do CRECI e completar o cadastro."
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Vamos Arrematar
        </span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
          {modo === "cadastro" ? "Crie sua conta grátis" : "Entrar"}
        </h1>
        {modo === "cadastro" ? (
          <p className="mt-2 leading-relaxed text-slate-600">
            É grátis. Depois do cadastro você envia a foto do CRECI e a identidade, e a nossa equipe
            libera o seu acesso.
          </p>
        ) : null}
      </div>
      <form action={enviar} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6">
        {modo === "cadastro" ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  ["corretor", "Sou corretor (CRECI)"],
                  ["imobiliaria", "Sou imobiliária (CRECI-J)"],
                  ["investidor", "Sou investidor"],
                  ["comprador", "Quero comprar para morar"],
                  ["proprietario", "Sou proprietário"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTipo(v)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-bold ${tipo === v ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-300"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              name="nome"
              required
              minLength={3}
              placeholder="Nome completo"
              className={campo}
            />
            {tipo === "corretor" || tipo === "imobiliaria" ? (
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <input name="creci" required placeholder="Número do CRECI" className={campo} />
                <select name="creci_uf" required defaultValue="RJ" className={`${campo} bg-white`}>
                  {BRAZILIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <TelefonesCampos />
          </>
        ) : null}
        <input name="email" type="email" required placeholder="E-mail" className={campo} />
        <input
          name="senha"
          type="password"
          required
          minLength={modo === "cadastro" ? 8 : 1}
          autoComplete={modo === "cadastro" ? "new-password" : "current-password"}
          placeholder={modo === "cadastro" ? "Crie uma senha (mínimo 8 caracteres)" : "Senha"}
          className={campo}
        />
        {modo === "cadastro" ? <LgpdAceite /> : null}
        {modo === "entrar" ? (
          <Link
            href="/corretores/recuperar"
            className="self-end text-sm font-bold text-[var(--brand)]"
          >
            Esqueci minha senha
          </Link>
        ) : null}
        {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
        {aviso ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>
        ) : null}
        <button
          disabled={enviando}
          className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
        >
          {enviando ? "Aguarde..." : modo === "cadastro" ? "Criar minha conta" : "Entrar"}
        </button>
      </form>
      <p className="text-center text-sm text-slate-600">
        {modo === "cadastro" ? (
          <>
            Já tem conta?{" "}
            <Link href="/corretores/entrar" className="font-bold text-[var(--brand)]">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Ainda não tem conta?{" "}
            <Link href="/corretores/cadastro" className="font-bold text-[var(--brand)]">
              Cadastre-se grátis
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
