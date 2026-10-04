/**
 * <LandingTemplate>: escolhe o modelo, aplica o tema e posiciona o formulário.
 *
 * Isomórfico e síncrono: funciona como Server Component (rota pública do L3)
 * e dentro de um Client Component (pré-visualização do editor do L2).
 *
 * Responsividade por CONTAINER QUERY (`@container` no wrapper): o layout
 * responde à largura do wrapper, não da janela — a pré-visualização num
 * painel estreito mostra o layout mobile real.
 *
 * Formulário (`leadForm`):
 * - ReactNode: o formulário pronto (Server Action do L3 ou formulário inerte do L2);
 * - função `(context: LeadFormContext) => ReactNode`: recebe o texto do botão,
 *   o tamanho sugerido (curto/completo) e demais dados do modelo.
 * O interesse escolhido na página (tipologia/imóvel) chega ao formulário por
 * `useLandingLeadInterest()` de `@/components/landing/lead-interest`.
 */
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { LandingLeadInterestProvider } from "@/components/landing/lead-interest"
import type { LandingLeadFormSize } from "@/lib/landing/templates"
import type { LandingPublicPayload, LandingTemplateKey } from "@/lib/landing/types"
import { buildLandingViewModel } from "@/lib/landing/view-model"

import { LEAD_FORM_ANCHOR, type LandingMode } from "./sections/primitives"
import { CampaignOfferTemplate } from "./templates/campaign_offer"
import { CampaignSpotlightTemplate } from "./templates/campaign_spotlight"
import { CampaignValuationTemplate } from "./templates/campaign_valuation"
import { LaunchShowcaseTemplate } from "./templates/launch_showcase"
import { LaunchUnitsTemplate } from "./templates/launch_units"
import { LaunchWaitlistTemplate } from "./templates/launch_waitlist"
import { PortfolioAgencyTemplate } from "./templates/portfolio_agency"
import { PortfolioBrokerTemplate } from "./templates/portfolio_broker"
import { PortfolioGridTemplate } from "./templates/portfolio_grid"
import type { LandingTemplateRenderProps } from "./templates/shared"

export type { LandingMode } from "./sections/primitives"

export type LeadFormContext = {
  templateKey: LandingTemplateKey
  mode: LandingMode
  /** Sugestão de campos: `short` = nome + contato; `full` = com mensagem. */
  size: LandingLeadFormSize
  /** Texto do botão de envio (mesmo dos CTAs da página). */
  submitLabel: string
  /** Título e descrição exibidos pelo painel (não repita no formulário). */
  title: string
  description: string
  /** Id do painel/âncora do formulário. */
  anchorId: string
  pageId: string
  pageSlug: string
}

export type LandingTemplateProps = {
  payload: LandingPublicPayload
  mode: LandingMode
  leadForm: ReactNode | ((context: LeadFormContext) => ReactNode)
  /** Base do Supabase para as imagens; padrão `NEXT_PUBLIC_SUPABASE_URL`. */
  storageBaseUrl?: string | null
  className?: string
}

const RADIUS_BY_CATEGORY = {
  campanhas: "[--lp-radius:0.625rem]",
  lancamentos: "[--lp-radius:0.125rem]",
  portfolio: "[--lp-radius:0.5rem]",
} as const

function renderTemplate(key: LandingTemplateKey, props: LandingTemplateRenderProps) {
  switch (key) {
    case "campaign_spotlight":
      return <CampaignSpotlightTemplate {...props} />
    case "campaign_offer":
      return <CampaignOfferTemplate {...props} />
    case "campaign_valuation":
      return <CampaignValuationTemplate {...props} />
    case "launch_showcase":
      return <LaunchShowcaseTemplate {...props} />
    case "launch_waitlist":
      return <LaunchWaitlistTemplate {...props} />
    case "launch_units":
      return <LaunchUnitsTemplate {...props} />
    case "portfolio_grid":
      return <PortfolioGridTemplate {...props} />
    case "portfolio_agency":
      return <PortfolioAgencyTemplate {...props} />
    case "portfolio_broker":
      return <PortfolioBrokerTemplate {...props} />
  }
}

export function LandingTemplate({
  payload,
  mode,
  leadForm,
  storageBaseUrl,
  className,
}: LandingTemplateProps) {
  const vm = buildLandingViewModel(payload, { storageBaseUrl })

  // Na página pública os ids são fixos (#lead-form). Na pré-visualização levam
  // o id da página, para vários modelos convivirem na mesma tela.
  const prefix = mode === "preview" ? `lp-${vm.page.id.replace(/[^a-zA-Z0-9_-]/g, "")}-` : ""
  const id = (name: string) => `${prefix}${name}`
  const anchorId = id(LEAD_FORM_ANCHOR)
  const formHref = `#${anchorId}`

  const form =
    typeof leadForm === "function"
      ? leadForm({
          templateKey: vm.key,
          mode,
          size: vm.template.leadFormSize,
          submitLabel: vm.copy.ctaLabel,
          title: vm.copy.formTitle,
          description: vm.copy.formDescription,
          anchorId,
          pageId: vm.page.id,
          pageSlug: vm.page.slug,
        })
      : leadForm

  return (
    <div
      data-landing-template={vm.key}
      data-landing-mode={mode}
      style={vm.theme.style}
      className={cn(
        RADIUS_BY_CATEGORY[vm.template.category],
        "@container relative isolate flex w-full min-w-0 flex-col bg-(--lp-surface) text-base text-(--lp-ink) antialiased",
        className
      )}
    >
      <LandingLeadInterestProvider>
        <a
          href={formHref}
          className="sr-only rounded-(--lp-radius) bg-(--lp-surface) px-4 py-2 font-semibold text-(--lp-ink) focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:outline-3 focus:outline-(--lp-focus)"
        >
          Ir para o formulário de contato
        </a>
        {renderTemplate(vm.key, { vm, mode, leadForm: form, id, formHref })}
      </LandingLeadInterestProvider>
    </div>
  )
}
