import type { Metadata } from "next"

import { PortalTracking } from "@/components/portal/portal-tracking"
import { SiteFooter } from "@/components/portal/site-footer"
import { SiteHeader } from "@/components/portal/site-header"
import { brandCssVars, PORTAL, whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: {
    template: `%s · ${PORTAL.name}`,
    default: `Leilão de imóveis em todo o Brasil · ${PORTAL.name}`,
  },
  description:
    "Imóveis de leilão da Caixa em todo o Brasil, com desconto sobre a avaliação, cálculo de custos e assessoria do edital à chave.",
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={brandCssVars()} className="flex min-h-screen flex-col bg-white text-slate-900">
      <SiteHeader name={PORTAL.name} logoUrl={PORTAL.logoUrl || undefined} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <a
        href={whatsappHref("Olá! Vim pelo portal de leilões.")}
        className="fixed right-4 bottom-4 z-30 rounded-full bg-[#15803D] px-5 py-3.5 text-sm font-bold text-white shadow-lg hover:opacity-95"
      >
        Fale conosco
      </a>
      <PortalTracking gtmId={PORTAL.gtmId} />
    </div>
  )
}
