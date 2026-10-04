"use client"

import * as React from "react"
import Link from "next/link"

import {
  criarPedido,
  resumirImoveis,
  type ItemResumo,
  type PedidoResultado,
} from "@/app/(site)/anunciar/actions"
import { useAdCart } from "@/components/portal/ad-cart"

export type PortalOpcao = { slug: string; nome: string; preco: number | null; dias: number }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export function AdOrderForm({
  portais,
  empresa,
  pagamento,
}: {
  portais: PortalOpcao[]
  empresa: string
  pagamento: string
}) {
  const cart = useAdCart()
  const [itens, setItens] = React.useState<ItemResumo[]>([])
  const [escolhidos, setEscolhidos] = React.useState<string[]>(portais.map((p) => p.slug))
  const [perfil, setPerfil] = React.useState("corretor")
  const [codigo, setCodigo] = React.useState("")
  const [res, setRes] = React.useState<PedidoResultado | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const chave = cart.ids.join(",")

  React.useEffect(() => {
    let vivo = true
    resumirImoveis(chave ? chave.split(",") : []).then((r) => vivo && setItens(r))
    return () => {
      vivo = false
    }
  }, [chave])

  const sel = portais.filter((p) => escolhidos.includes(p.slug))
  const semPreco = sel.some((p) => p.preco == null)
  const total = semPreco ? null : sel.reduce((s, p) => s + (p.preco ?? 0), 0) * itens.length

  if (res?.ok) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-xl font-extrabold">Pedido {res.codigo} registrado</h2>
        <p className="text-slate-700">
          {res.imoveis} imóve{res.imoveis === 1 ? "l" : "is"} por {res.dias} dias.{" "}
          {res.valor != null
            ? `Valor: ${brl(res.valor)}.`
            : "O valor será informado pela nossa equipe."}
        </p>
        <p className="text-slate-700">{pagamento}</p>
        <p className="text-sm text-slate-600">
          Depois do pagamento, a {empresa} confere e libera os anúncios. Os portais atualizam a
          lista em até um dia.
        </p>
      </div>
    )
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1.2fr_1fr]"
      action={async (fd) => {
        setEnviando(true)
        fd.set("imoveis", itens.map((i) => i.id).join(","))
        const r = await criarPedido(fd)
        setRes(r)
        setEnviando(false)
        if (r.ok) cart.limpar()
      }}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded-2xl border border-slate-200 p-5">
          <h2 className="text-lg font-extrabold">1. Imóveis ({itens.length})</h2>
          {itens.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {itens.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/leiloes/${i.id}`} className="font-bold hover:text-[var(--brand)]">
                      {i.titulo}
                    </Link>
                    <p className="truncate text-sm text-slate-600">
                      {i.origem} · {i.local} · {i.preco}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cart.remover(i.id)}
                    className="shrink-0 text-sm font-bold text-slate-500"
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              Nenhum imóvel marcado. Marque em{" "}
              <Link href="/leiloes" className="font-bold text-[var(--brand)]">
                Leilões
              </Link>{" "}
              ou digite o código abaixo.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.trim().toLowerCase())}
              placeholder="Código do imóvel"
              className="h-10 flex-1 rounded-lg border border-slate-300 px-3"
            />
            <button
              type="button"
              onClick={() => {
                if (codigo) cart.definir([...cart.ids, codigo])
                setCodigo("")
              }}
              className="rounded-lg border border-slate-300 px-4 text-sm font-bold"
            >
              Adicionar
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 p-5">
          <h2 className="text-lg font-extrabold">2. Onde anunciar</h2>
          <div className="mt-3 flex flex-col gap-2">
            {portais.map((p) => (
              <label
                key={p.slug}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    name="portais"
                    value={p.slug}
                    checked={escolhidos.includes(p.slug)}
                    onChange={(e) =>
                      setEscolhidos(
                        e.target.checked
                          ? [...escolhidos, p.slug]
                          : escolhidos.filter((s) => s !== p.slug)
                      )
                    }
                    className="size-5"
                  />
                  <span className="font-semibold">{p.nome}</span>
                </span>
                <span className="text-sm text-slate-600">
                  {p.preco != null ? `${brl(p.preco)} por imóvel, ${p.dias} dias` : "Sob consulta"}
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-24 lg:self-start">
        <h2 className="text-lg font-extrabold">3. Seus dados</h2>
        <div className="flex gap-2">
          {(
            [
              ["corretor", "Sou corretor"],
              ["cliente", "Sou cliente"],
              ["proprietario", "Sou proprietário"],
            ] as const
          ).map(([v, l]) => (
            <label
              key={v}
              className={`flex-1 cursor-pointer rounded-lg border px-2 py-2 text-center text-sm font-bold ${perfil === v ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-300"}`}
            >
              <input
                type="radio"
                name="perfil"
                value={v}
                checked={perfil === v}
                onChange={() => setPerfil(v)}
                className="sr-only"
              />
              {l}
            </label>
          ))}
        </div>
        <input
          name="nome"
          required
          minLength={2}
          placeholder="Nome completo"
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
          placeholder="E-mail"
          className="h-11 rounded-lg border border-slate-300 px-3"
        />
        {perfil === "corretor" ? (
          <input
            name="creci"
            required
            placeholder="CRECI (ex.: CRECI-RJ 00000)"
            className="h-11 rounded-lg border border-slate-300 px-3"
          />
        ) : null}
        <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <label className="block text-xs leading-relaxed text-slate-700">
          <input
            type="checkbox"
            name="termo"
            required
            className="mr-2 inline size-4 align-[-3px]"
          />
          Declaro que tenho autorização para anunciar estes imóveis e que respondo pelo atendimento
          dos interessados. A publicação nos portais é feita pela {empresa}, depois do pagamento e
          da aprovação.
        </label>
        <label className="block text-xs leading-relaxed text-slate-700">
          <input
            type="checkbox"
            name="consentimento"
            required
            className="mr-2 inline size-4 align-[-3px]"
          />
          Autorizo o uso dos meus dados para tratar este pedido, conforme a{" "}
          <Link href="/privacidade" className="font-bold underline">
            Política de Privacidade
          </Link>
          .
        </label>
        <div className="rounded-xl bg-slate-50 p-3">
          <span className="text-sm text-slate-600">Total</span>
          <p className="text-2xl font-extrabold">
            {total != null ? brl(total) : itens.length && sel.length ? "Sob consulta" : "R$ 0,00"}
          </p>
        </div>
        {res && !res.ok ? <p className="text-sm font-bold text-red-700">{res.erro}</p> : null}
        <button
          disabled={enviando || !itens.length || !sel.length}
          className="h-12 rounded-xl bg-[var(--brand)] font-bold text-white disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Gerar pedido e pagar"}
        </button>
      </section>
    </form>
  )
}
