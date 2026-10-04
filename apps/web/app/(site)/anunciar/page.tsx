import type { Metadata } from "next"
import { createClient } from "@supabase/supabase-js"

import { PageHero } from "@/components/portal/content"
import { AdOrderForm, type PortalOpcao } from "@/components/portal/ad-order-form"
import { PORTAL } from "@/lib/portal/config"
import { getSupabaseEnv } from "@/lib/supabase/env"

export const metadata: Metadata = {
  title: "Anunciar nos portais imobiliários",
  description:
    "Escolha os imóveis e os portais, veja o valor, pague e a nossa equipe publica no ZAP Imóveis, Viva Real, OLX e outros.",
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

export default async function AnunciarPage() {
  const portais = await carregarPortais()
  const pagamento =
    process.env.NEXT_PUBLIC_PAGAMENTO_INSTRUCOES?.trim() ||
    `Nossa equipe envia o link de pagamento pelo WhatsApp ${PORTAL.whatsappLabel}.`
  return (
    <>
      <PageHero
        kicker="Publicidade nos portais"
        title="Seus imóveis no ZAP, Viva Real, OLX e outros portais, sem precisar de conta própria."
        text="Marque os imóveis, escolha os portais e veja o valor na hora. Depois do pagamento, a nossa equipe confere e publica pela conta da empresa."
      />
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        {portais.length ? (
          <AdOrderForm portais={portais} empresa={PORTAL.legalName} pagamento={pagamento} />
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            A venda de anúncios nos portais abre em breve.
          </p>
        )}
      </div>
    </>
  )
}
