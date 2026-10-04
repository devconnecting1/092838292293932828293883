import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { createClient } from "@supabase/supabase-js"

import { ImprimirAuto } from "@/components/portal/imprimir-auto"
import { ListingCard } from "@/components/portal/listing-card"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { toPortalListing } from "@/lib/portal/imoveis"
import { getSupabaseEnv } from "@/lib/supabase/env"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Oportunidades selecionadas", robots: { index: false } }

type Autor = {
  nome: string | null
  perfil: string | null
  creci: string | null
  creci_uf: string | null
  whatsapp: string | null
  foto_path: string | null
  slug: string | null
  verificado: boolean
}

export default async function SelecaoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  if (!/^[a-z0-9]{6,20}$/.test(codigo)) notFound()
  const env = getSupabaseEnv()
  if (!env) notFound()
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data } = await sb.rpc("selecao_publica", { p_codigo: codigo })
  const s = data as {
    titulo: string
    mensagem: string | null
    imoveis: string[]
    autor: Autor
  } | null
  if (!s) notFound()
  const { data: rows } = await sb.from("imoveis").select("*").in("id", s.imoveis).eq("ativo", true)
  const itens = (rows ?? []).map(toPortalListing)
  const a = s.autor
  const foto = a.foto_path
    ? sb.storage.from("corretores-fotos").getPublicUrl(a.foto_path).data.publicUrl
    : null
  const zap = a.whatsapp?.replace(/\D/g, "")
  const wa = zap
    ? `https://wa.me/${zap.startsWith("55") ? zap : `55${zap}`}?text=${encodeURIComponent("Olá! Vi as oportunidades que você me mandou e quero saber mais.")}`
    : null

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
      <ImprimirAuto />
      <section className="flex flex-wrap items-center gap-5 rounded-3xl bg-[var(--brand-soft)] p-6">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={foto}
            alt={a.nome ?? ""}
            className="size-20 rounded-2xl object-cover ring-4 ring-white"
          />
        ) : null}
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{s.titulo}</h1>
          <p className="text-slate-700">
            Selecionadas por <b>{a.nome}</b>
            {a.creci ? `, CRECI ${a.creci}${a.creci_uf ? `/${a.creci_uf}` : ""}` : ""}
            {a.verificado ? " · corretor verificado" : ""}
          </p>
          {s.mensagem ? <p className="mt-1 text-slate-700">{s.mensagem}</p> : null}
        </div>
        {wa ? (
          <a
            href={wa}
            className="rounded-xl bg-[#15803D] px-6 py-3.5 font-extrabold text-white print:hidden"
          >
            Falar no WhatsApp
          </a>
        ) : null}
      </section>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((i) => (
          <ListingCard key={i.numero} item={i} photos={areCaixaPhotosEnabled()} />
        ))}
      </div>
      {itens.length === 0 ? (
        <p className="text-slate-600">Estes imóveis não estão mais disponíveis.</p>
      ) : null}
      <p className="text-xs text-slate-500">
        Valores e condições conforme o edital de cada imóvel. Confira edital e matrícula antes do
        lance.
      </p>
    </div>
  )
}
