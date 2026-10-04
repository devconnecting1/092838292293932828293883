import type { Metadata } from "next"

import { AdCartBar } from "@/components/portal/ad-cart"
import { BackButton } from "@/components/portal/back-button"
import { ContactButton } from "@/components/portal/contact-button"
import { PortalTracking } from "@/components/portal/portal-tracking"
import { SiteFooter } from "@/components/portal/site-footer"
import { SiteHeader } from "@/components/portal/site-header"
import { CSS_TEMA_ESCURO, SCRIPT_TEMA } from "@/components/portal/tema-idioma"
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
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      <style dangerouslySetInnerHTML={{ __html: CSS_TEMA_ESCURO }} />
      <SiteHeader
        name={PORTAL.name}
        logoUrl={PORTAL.logoUrl || undefined}
        phone={{ href: `tel:${PORTAL.whatsapp}`, label: PORTAL.whatsappLabel }}
      />
      <main className="flex-1">
        <BackButton />
        {children}
      </main>
      <SiteFooter />
      <ContactButton />
      <AdCartBar />
      <PortalTracking gtmId={PORTAL.gtmId} />
    </div>
  )
}
