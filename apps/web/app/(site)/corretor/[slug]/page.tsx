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
  redes?: Record<string, string> | null
  perfil?: string | null
  bio?: string | null
  atua_desde?: number | null
  bairros?: string[] | null
  email?: string | null
  selo_verde?: boolean | null
  email_verificado?: boolean | null
  whatsapp_verificado?: boolean | null
  redes_verificadas?: boolean | null
}

function Verificado({ ok, children }: { ok?: boolean | null; children: React.ReactNode }) {
  if (!ok) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
      ✓ {children}
    </span>
  )
}

const NOMES_REDES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  site: "Site",
  outra: "Outra rede",
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
          {c.selo_verde ? (
            <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-extrabold text-white">
              Selo Verde: corretor verificado
            </span>
          ) : null}
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{c.nome}</h1>
          <p className="text-slate-700">
            {c.perfil === "imobiliaria"
              ? `Imobiliária, CRECI ${c.creci ?? ""}${c.creci_uf ? `/${c.creci_uf}` : ""}`
              : c.creci
                ? `Corretor de imóveis, CRECI ${c.creci}${c.creci_uf ? `/${c.creci_uf}` : ""}`
                : "Investidor imobiliário"}
            {c.cidade ? ` · ${c.cidade}/${c.uf}` : ""}
            {c.atua_desde ? ` · ${new Date().getFullYear() - c.atua_desde} anos de mercado` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Verificado ok={c.whatsapp_verificado}>WhatsApp verificado</Verificado>
            <Verificado ok={c.email_verificado}>E-mail verificado</Verificado>
            <Verificado ok={c.redes_verificadas}>Redes verificadas</Verificado>
          </div>
          {c.email ? (
            <a
              href={`mailto:${c.email}`}
              className="mt-2 inline-block text-sm font-bold text-[var(--brand)]"
            >
              {c.email}
            </a>
          ) : null}
        </div>
        {wa ? (
          <a href={wa} className="rounded-xl bg-[#15803D] px-6 py-3.5 font-extrabold text-white">
            Falar no WhatsApp
          </a>
        ) : null}
      </section>
      {c.bio || c.bairros?.length ? (
        <section className="grid gap-6 rounded-3xl border border-slate-200 p-6 sm:p-8 md:grid-cols-[2fr_1fr]">
          {c.bio ? (
            <div>
              <h2 className="text-xl font-extrabold">Quem sou eu</h2>
              <p className="mt-2 leading-relaxed whitespace-pre-line text-slate-700">{c.bio}</p>
            </div>
          ) : null}
          {c.bairros?.length ? (
            <div>
              <h2 className="text-xl font-extrabold">Onde eu atendo</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.bairros.map((b) => (
                  <span key={b} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      {c.redes && Object.keys(c.redes).length ? (
        <nav className="flex flex-wrap gap-2" aria-label="Redes sociais">
          {Object.entries(c.redes)
            .filter(([, u]) => /^https:\/\//.test(u))
            .map(([k, u]) => (
              <a
                key={k}
                href={u}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold hover:border-[var(--brand)]"
              >
                {NOMES_REDES[k] ?? k}
              </a>
            ))}
        </nav>
      ) : null}
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
      {wa ? (
        <a
          href={wa}
          className="fixed bottom-24 left-4 z-40 flex items-center gap-3 rounded-full bg-white py-2 pr-5 pl-2 shadow-xl ring-2 ring-[#15803D] print:hidden"
          aria-label={`Falar com ${c.nome} no WhatsApp`}
        >
          {c.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.foto} alt="" className="size-12 rounded-full object-cover" />
          ) : (
            <span className="grid size-12 place-items-center rounded-full bg-[#15803D] text-lg font-extrabold text-white">
              {c.nome.slice(0, 1)}
            </span>
          )}
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-extrabold">
              {c.nome.split(" ").slice(0, 2).join(" ")}
            </span>
            <span className="text-xs text-slate-600">
              {c.creci ? `CRECI ${c.creci}${c.creci_uf ? `/${c.creci_uf}` : ""}` : "WhatsApp"}
            </span>
            <span className="text-xs font-bold text-[#15803D]">Chamar no WhatsApp</span>
          </span>
        </a>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">
        Página do corretor {c.nome}. O atendimento e a intermediação são de responsabilidade do
        corretor, sob o seu CRECI.
      </p>
    </div>
  )
}
