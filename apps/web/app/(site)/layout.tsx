import type { Metadata } from "next"

import { AdCartBar } from "@/components/portal/ad-cart"
import { ContactButton } from "@/components/portal/contact-button"
import { PortalTracking } from "@/components/portal/portal-tracking"
import { SiteFooter } from "@/components/portal/site-footer"
import { SiteHeader } from "@/components/portal/site-header"
import { brandCssVars, PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: {
    template: `%s · ${PORTAL.name}`,
    absolute: `Leilão de imóveis em todo o Brasil · ${PORTAL.name}`,
  },
  description:
    "Imóveis de leilão da Caixa em todo o Brasil, com desconto sobre a avaliação, cálculo de custos e assessoria do edital à chave.",
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={brandCssVars()} className="flex min-h-screen flex-col bg-white text-slate-900">
      <SiteHeader
        name={PORTAL.name}
        logoUrl={PORTAL.logoUrl || undefined}
        phone={{ href: `tel:${PORTAL.whatsapp}`, label: PORTAL.whatsappLabel }}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <ContactButton />
      <AdCartBar />
      <PortalTracking gtmId={PORTAL.gtmId} />
    </div>
  )
}
