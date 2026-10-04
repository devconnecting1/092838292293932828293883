"use client"

import * as React from "react"
import Link from "next/link"
import { BellIcon } from "lucide-react"

import { portalBrowserClient } from "@/lib/portal/browser-client"

type Aviso = {
  id: number
  titulo: string
  texto: string
  link: string | null
  lida: boolean
  urgente: boolean
  criado: string
}

function bip() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.value = 0.08
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.18)
  } catch {
    /* sem som neste navegador */
  }
}

/**
 * Sino de alertas do usuário logado: confere a cada minuto, toca um aviso sonoro e mostra a
 * notificação do navegador quando chega alerta urgente (prazo de cliente, tarefa atrasada).
 */
export function AlertasSino() {
  const [logado, setLogado] = React.useState(false)
  const [lista, setLista] = React.useState<Aviso[]>([])
  const [aberto, setAberto] = React.useState(false)
  const vistos = React.useRef<Set<number> | null>(null)

  const carregar = React.useCallback(async () => {
    const sb = portalBrowserClient()
    if (!sb) return
    const { data: s } = await sb.auth.getSession()
    if (!s.session) return setLogado(false)
    setLogado(true)
    const { data } = await sb
      .from("notificacoes")
      .select("id, titulo, texto, link, lida, urgente, criado")
      .eq("user_id", s.session.user.id)
      .order("criado", { ascending: false })
      .limit(30)
    const novos = (data as Aviso[] | null) ?? []
    if (vistos.current) {
      const chegaram = novos.filter((n) => !n.lida && !vistos.current?.has(n.id))
      if (chegaram.length) {
        bip()
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          for (const n of chegaram.slice(0, 3))
            new Notification(n.titulo, { body: n.texto, tag: `va-${n.id}` })
      }
    }
    vistos.current = new Set(novos.map((n) => n.id))
    setLista(novos)
  }, [])

  React.useEffect(() => {
    const t = setTimeout(carregar, 500)
    const i = setInterval(carregar, 60_000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [carregar])

  async function marcarLidas() {
    const sb = portalBrowserClient()
    const ids = lista.filter((n) => !n.lida).map((n) => n.id)
    if (!sb || !ids.length) return
    await sb.from("notificacoes").update({ lida: true }).in("id", ids)
    setLista((l) => l.map((n) => ({ ...n, lida: true })))
  }

  if (!logado) return null
  const naoLidas = lista.filter((n) => !n.lida)
  const urgentes = naoLidas.some((n) => n.urgente)
  const podeAtivar = typeof Notification !== "undefined" && Notification.permission === "default"

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Alertas: ${naoLidas.length} sem ler`}
        onClick={() => setAberto((a) => !a)}
        className="relative flex size-10 items-center justify-center rounded-lg border border-slate-300 bg-white"
      >
        <BellIcon className="size-5" />
        {naoLidas.length ? (
          <span
            className={`absolute -top-1.5 -right-1.5 min-w-5 rounded-full px-1 text-[11px] leading-5 font-bold text-white ${urgentes ? "animate-pulse bg-red-600" : "bg-[var(--brand)]"}`}
          >
            {naoLidas.length > 9 ? "9+" : naoLidas.length}
          </span>
        ) : null}
      </button>
      {aberto ? (
        <div className="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[340px] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 p-3">
            <b>Alertas</b>
            <button
              type="button"
              onClick={marcarLidas}
              className="text-xs font-bold text-[var(--brand)]"
            >
              Marcar todos como lidos
            </button>
          </div>
          {podeAtivar ? (
            <button
              type="button"
              onClick={() => void Notification.requestPermission()}
              className="bg-amber-50 p-3 text-left text-xs font-bold text-amber-900"
            >
              Ativar alertas na tela do computador e do celular
            </button>
          ) : null}
          <ul className="overflow-y-auto">
            {lista.length ? (
              lista.map((n) => (
                <li
                  key={n.id}
                  className={`border-b border-slate-100 p-3 text-sm ${n.lida ? "text-slate-500" : ""}`}
                >
                  <Link
                    href={n.link ?? "/minha-conta"}
                    onClick={() => setAberto(false)}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-bold">
                      {n.urgente && !n.lida ? "● " : ""}
                      {n.titulo}
                    </span>
                    <span>{n.texto}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(n.criado).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))
            ) : (
              <li className="p-4 text-sm text-slate-500">Nenhum alerta. Tudo em dia.</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
