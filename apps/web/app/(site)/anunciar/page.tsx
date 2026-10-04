import type { Metadata } from "next"
import { createClient } from "@supabase/supabase-js"

import type { PortalOpcao } from "@/components/portal/ad-order-form"
import { PublicidadeCorretor } from "@/components/portal/publicidade"
import { SoCorretor } from "@/components/portal/corretor-acoes"
import { PORTAL } from "@/lib/portal/config"
import { getSupabaseEnv } from "@/lib/supabase/env"

export const metadata: Metadata = {
  title: "Anuncie seus imóveis nas redes sociais e nos maiores portais do Brasil",
  description:
    "Marque os imóveis, veja o valor na hora e pague. A nossa equipe publica nas redes sociais e nos maiores portais imobiliários e parceiros do Brasil.",
}

export const revalidate = 300

async function carregarPortais(): Promise<PortalOpcao[]> {
  const env = getSupabaseEnv()
  if (!env) return []
  const supabase = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data } = await supabase
    .from("portais")
    .select("slug,nome,preco_por_imovel,dias")
    .eq("ativo", true)
    .order("ordem")
  return (data ?? []).map((p) => ({
    slug: String(p.slug),
    nome: String(p.nome),
    preco: p.preco_por_imovel == null ? null : Number(p.preco_por_imovel),
    dias: Number(p.dias ?? 30),
  }))
}

const PASSOS = [
  {
    n: "1",
    t: "Marque os imóveis",
    d: "Na lista de leilões ou na página do imóvel, toque em “Anunciar nos portais”.",
  },
  {
    n: "2",
    t: "Veja o valor e pague",
    d: "Escolha onde quer aparecer. O valor sai na hora, por imóvel e por período.",
  },
  {
    n: "3",
    t: "Nós publicamos",
    d: "Depois do pagamento e da conferência, a nossa equipe publica pela conta da empresa.",
  },
]

const CANAIS = [
  {
    t: "Maiores portais imobiliários",
    d: "Onde a maior parte dos compradores começa a busca.",
    icon: <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  },
  {
    t: "Redes sociais",
    d: "Arte e texto prontos, no feed e nos stories da plataforma.",
    icon: (
      <path d="M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0M17.5 6.5h.01M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
    ),
  },
  {
    t: "Portais parceiros",
    d: "Mais alcance em portais nacionais e regionais da nossa rede.",
    icon: (
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    ),
  },
]

export default async function AnunciarPage() {
  const portais = await carregarPortais()
  const pagamento =
    process.env.NEXT_PUBLIC_PAGAMENTO_INSTRUCOES?.trim() ||
    `Nossa equipe envia o link de pagamento pelo ${PORTAL.whatsappLabel}.`

  return (
    <>
      <section className="relative overflow-hidden bg-[var(--brand-deep)] text-white">
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-24 size-[520px] rounded-full bg-[var(--brand)] opacity-40 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:py-20">
          <div className="flex flex-col gap-5">
            <span className="self-start rounded-full bg-white/15 px-3 py-1 text-sm font-bold">
              Publicidade para corretores, proprietários e investidores
            </span>
            <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl">
              Seus imóveis nas redes sociais e nos maiores portais imobiliários do Brasil.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/85">
              Um único pedido coloca o seu imóvel na frente de quem está procurando, nos maiores
              portais e nos parceiros da nossa rede. Você escolhe, paga e a gente cuida do resto.
            </p>
            <a
              href="#pedido"
              className="self-start rounded-xl bg-white px-6 py-3.5 font-extrabold text-[var(--brand-deep)] hover:opacity-95"
            >
              Montar meu pedido
            </a>
          </div>
          <ul className="grid gap-3 self-center">
            {CANAIS.map((c) => (
              <li
                key={c.t}
                className="flex items-start gap-4 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand-deep)]">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {c.icon}
                  </svg>
                </span>
                <span>
                  <span className="block font-extrabold">{c.t}</span>
                  <span className="text-sm text-white/80">{c.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-[var(--brand-soft)]">
        <ol className="mx-auto grid max-w-[1240px] gap-4 px-4 py-8 sm:px-6 md:grid-cols-3">
          {PASSOS.map((p) => (
            <li key={p.n} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--brand)] font-extrabold text-white">
                {p.n}
              </span>
              <span>
                <span className="block font-extrabold">{p.t}</span>
                <span className="text-sm leading-relaxed text-slate-700">{p.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div id="pedido" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 py-12 sm:px-6">
        {portais.length ? (
          <SoCorretor>
            <PublicidadeCorretor />
          </SoCorretor>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            A venda de anúncios abre em breve. Fale com a gente pelo {PORTAL.whatsappLabel}.
          </p>
        )}
      </div>
    </>
  )
}
