import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@supabase/supabase-js"

import { ListingCard } from "@/components/portal/listing-card"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { parsePortalFilters, searchPortalListings } from "@/lib/portal/imoveis"
import { getSupabaseEnv } from "@/lib/supabase/env"

export const revalidate = 600

type Props = { params: Promise<{ slug: string }> }

type Corretor = {
  slug: string
  nome: string
  creci: string | null
  creci_uf: string | null
  whatsapp: string | null
  cidade: string | null
  uf: string | null
  foto_path: string | null
}

async function carregar(slug: string) {
  if (!/^[a-z0-9]{2,30}$/.test(slug)) return null
  const env = getSupabaseEnv()
  if (!env) return null
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data } = await sb.rpc("corretor_publico", { p_slug: slug })
  const c = (Array.isArray(data) ? data[0] : null) as Corretor | null
  if (!c) return null
  const foto = c.foto_path
    ? sb.storage.from("corretores-fotos").getPublicUrl(c.foto_path).data.publicUrl
    : null
  return { ...c, foto }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await carregar((await params).slug)
  if (!c) return { title: "Corretor não encontrado", robots: { index: false } }
  return {
    title: `${c.nome}, corretor de imóveis de leilão`,
    description: `Imóveis de leilão com ${c.nome}, CRECI ${c.creci ?? ""}${c.creci_uf ? `/${c.creci_uf}` : ""}.`,
  }
}

export default async function CorretorPage({ params }: Props) {
  const c = await carregar((await params).slug)
  if (!c) notFound()
  const uf = c.uf ?? ""
  const { items } = await searchPortalListings(parsePortalFilters({ uf, desconto: "30" }), 12)
  const zap = c.whatsapp?.replace(/\D/g, "")
  const wa = zap
    ? `https://wa.me/${zap.startsWith("55") ? zap : `55${zap}`}?text=${encodeURIComponent(`Olá, ${c.nome}! Vi sua página de leilões e quero ajuda.`)}`
    : null

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-10 sm:px-6">
      <section className="flex flex-wrap items-center gap-6 rounded-3xl bg-[var(--brand-soft)] p-6 sm:p-8">
        {c.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.foto}
            alt={c.nome}
            className="size-28 rounded-2xl object-cover ring-4 ring-white"
          />
        ) : null}
        <div className="flex-1">
          <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-extrabold text-white">
            Selo Verde
          </span>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{c.nome}</h1>
          <p className="text-slate-700">
            {c.creci
              ? `Corretor de imóveis, CRECI ${c.creci}${c.creci_uf ? `/${c.creci_uf}` : ""}`
              : "Investidor imobiliário"}
            {c.cidade ? ` · ${c.cidade}/${c.uf}` : ""}
          </p>
        </div>
        {wa ? (
          <a href={wa} className="rounded-xl bg-[#15803D] px-6 py-3.5 font-extrabold text-white">
            Falar no WhatsApp
          </a>
        ) : null}
      </section>
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Oportunidades {uf ? `em ${uf}` : "no Brasil"}
          </h2>
          <Link href={`/leiloes${uf ? `?uf=${uf}` : ""}`} className="font-bold text-[var(--brand)]">
            Ver todos os leilões
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((i) => (
            <ListingCard key={i.numero} item={i} photos={areCaixaPhotosEnabled()} />
          ))}
        </div>
      </section>
      <p className="text-xs leading-relaxed text-slate-500">
        Página do corretor {c.nome}. O atendimento e a intermediação são de responsabilidade do
        corretor, sob o seu CRECI.
      </p>
    </div>
  )
}
