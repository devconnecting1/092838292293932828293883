"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { portalBrowserClient } from "@/lib/portal/browser-client"

const campo = "h-11 rounded-lg border border-slate-300 px-3"

/** Pede o link de troca de senha por e-mail. Resposta igual exista ou não a conta. */
export function RecuperarSenha() {
  const [enviado, setEnviado] = React.useState(false)
  const [ocupado, setOcupado] = React.useState(false)

  async function enviar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return
    setOcupado(true)
    await sb.auth.resetPasswordForEmail(
      String(fd.get("email") ?? "")
        .trim()
        .toLowerCase(),
      {
        redirectTo: `${window.location.origin}/corretores/nova-senha`,
      }
    )
    setOcupado(false)
    setEnviado(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Área do corretor
        </span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Recuperar senha</h1>
        <p className="mt-2 text-slate-600">
          Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha.
        </p>
      </div>
      {enviado ? (
        <p className="rounded-2xl bg-emerald-50 p-5 text-emerald-900">
          Se existir uma conta com esse e-mail, o link chega em alguns minutos. Confira também a
          caixa de spam.
        </p>
      ) : (
        <form
          action={enviar}
          className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6"
        >
          <input name="email" type="email" required placeholder="E-mail" className={campo} />
          <button
            disabled={ocupado}
            className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
          >
            {ocupado ? "Enviando..." : "Enviar link"}
          </button>
        </form>
      )}
      <Link href="/corretores/entrar" className="text-center text-sm font-bold text-[var(--brand)]">
        Voltar para entrar
      </Link>
    </div>
  )
}

/** Página aberta pelo link do e-mail: o Supabase cria a sessão de recuperação pela URL. */
export function NovaSenha() {
  const router = useRouter()
  const [pronto, setPronto] = React.useState<boolean | null>(null)
  const [erro, setErro] = React.useState("")
  const [ocupado, setOcupado] = React.useState(false)

  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: sub } = sb.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "PASSWORD_RECOVERY" || sessao) setPronto(true)
    })
    const t = setTimeout(async () => {
      const { data } = await sb.auth.getSession()
      setPronto((p) => p ?? !!data.session)
    }, 1500)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  async function salvar(fd: FormData) {
    const sb = portalBrowserClient()
    if (!sb) return
    const s1 = String(fd.get("senha") ?? "")
    const s2 = String(fd.get("senha2") ?? "")
    if (s1.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.")
    if (s1 !== s2) return setErro("As duas senhas não são iguais.")
    setOcupado(true)
    const { error } = await sb.auth.updateUser({ password: s1 })
    setOcupado(false)
    if (error) return setErro("O link venceu ou já foi usado. Peça um novo.")
    router.push("/corretores/painel")
  }

  if (pronto === null) return <p className="text-slate-600">Conferindo o link...</p>
  if (!pronto)
    return (
      <p className="rounded-2xl border border-slate-200 p-6">
        Link inválido ou vencido.{" "}
        <Link href="/corretores/recuperar" className="font-bold text-[var(--brand)]">
          Pedir um novo link
        </Link>
      </p>
    )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Criar nova senha</h1>
      <form action={salvar} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6">
        <input
          name="senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Nova senha (mínimo 8 caracteres)"
          className={campo}
        />
        <input
          name="senha2"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Repita a nova senha"
          className={campo}
        />
        {erro ? <p className="text-sm font-bold text-red-700">{erro}</p> : null}
        <button
          disabled={ocupado}
          className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
        >
          {ocupado ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>
    </div>
  )
}
