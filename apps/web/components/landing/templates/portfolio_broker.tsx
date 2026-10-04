import { MessageCircleIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import {
  LandingImage,
  Paragraphs,
  Section,
  SectionHeading,
  lpButtonClass,
  lpDisplayFont,
} from "../sections/primitives"
import { PropertyGrid } from "../sections/property-grid"
import { StatsRow } from "../sections/social-proof"
import { Testimonials } from "../sections/testimonials"
import { CreciSeal } from "../sections/trust"
import { DISCLAIMERS, type LandingTemplateRenderProps } from "./shared"

/**
 * Página do corretor — uma pessoa, não uma marca.
 * Retrato vertical grande com a faixa da cor da imobiliária na base, nome em
 * corpo condensado e o CRECI logo abaixo. O WhatsApp vem antes do formulário
 * (é como o público do Instagram prefere falar), mas o formulário fecha a
 * página junto com depoimentos e números.
 */
export function PortfolioBrokerTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const broker = vm.broker
  const name = broker?.name ?? vm.organization.name
  const initials = broker?.initials ?? vm.organization.initials
  const creci = broker?.creciLabel ?? vm.organization.creciLabel
  const photo = broker?.avatarUrl ?? null

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="solid" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="bg-(--lp-surface-alt) text-(--lp-ink)"
        >
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 @3xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] @3xl:items-center @3xl:gap-14 @3xl:px-8 @3xl:py-16">
            <div className="relative mx-auto aspect-4/5 w-full max-w-64 overflow-hidden rounded-[calc(var(--lp-radius)*2)] bg-(--lp-primary) @3xl:max-w-none">
              {photo ? (
                <LandingImage
                  src={photo}
                  alt={`Foto de ${name}`}
                  width={640}
                  height={800}
                  priority
                  sizes="(min-width: 768px) 19rem, 16rem"
                  className="size-full"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex size-full items-center justify-center text-(--lp-on-primary)"
                >
                  <span className={cn(lpDisplayFont, "text-[5.5rem] font-bold tracking-tight")}>
                    {initials}
                  </span>
                </div>
              )}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-2 bg-(--lp-brand)"
              />
            </div>

            <div className="flex flex-col gap-5">
              <h1
                id={id("hero-title")}
                className={cn(
                  lpDisplayFont,
                  "text-[2.5rem] leading-none font-bold tracking-tight text-balance @xl:text-[3.5rem]"
                )}
              >
                {name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {creci ? <Badge variant="outline">{creci}</Badge> : null}
                {broker ? (
                  <span className="text-sm text-(--lp-ink-muted)">
                    Equipe {vm.organization.name}
                  </span>
                ) : null}
              </div>
              <p className="max-w-xl text-xl leading-snug text-balance">{vm.copy.headline}</p>
              <p className="max-w-xl leading-relaxed text-pretty text-(--lp-ink-muted)">
                {vm.copy.subheadline}
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                {vm.whatsappHref ? (
                  <a
                    href={vm.whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={lpButtonClass({ size: "lg" })}
                  >
                    <MessageCircleIcon aria-hidden="true" />
                    Chamar no WhatsApp
                    <span className="sr-only">(abre em nova aba)</span>
                  </a>
                ) : null}
                <a
                  href={formHref}
                  className={lpButtonClass({
                    tone: vm.whatsappHref ? "outline" : "primary",
                    size: "lg",
                  })}
                >
                  {vm.copy.ctaLabel}
                </a>
              </div>
            </div>
          </div>
        </section>

        {vm.description || vm.highlights.length > 0 ? (
          <Section labelledBy={id("about-title")}>
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl:gap-16">
              <div className="flex flex-col gap-6">
                <SectionHeading
                  id={id("about-title")}
                  title={broker ? "Sobre mim" : `Sobre a ${vm.organization.name}`}
                />
                {vm.description ? <Paragraphs text={vm.description} /> : null}
              </div>
              {vm.highlights.length > 0 ? (
                <div className="flex flex-col gap-4 @4xl:pt-3">
                  <h3 className="font-semibold">Especialidades</h3>
                  <ul className="flex flex-wrap gap-2">
                    {vm.highlights.map((item, index) => (
                      <li key={`${index}-${item}`}>
                        <Badge variant="secondary">{item}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        <Section tone="alt" labelledBy={id("properties-title")}>
          <div className="flex flex-col gap-8">
            <SectionHeading
              id={id("properties-title")}
              title={broker ? "Imóveis que eu atendo" : "Imóveis disponíveis"}
            />
            <PropertyGrid
              properties={vm.properties}
              formHref={formHref}
              mode={mode}
              ctaLabel={vm.copy.ctaLabel}
            />
          </div>
        </Section>

        <Section labelledBy={id("contact-title")}>
          <div className="grid gap-12 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-start @4xl:gap-16">
            <div className="flex flex-col gap-10">
              <SectionHeading
                id={id("contact-title")}
                title="Quem já foi atendido"
                description="Números e relatos de clientes que compraram, venderam ou alugaram comigo."
              />
              <StatsRow stats={vm.socialProof} columns={2} />
              <Testimonials items={vm.testimonials} layout="column" />
            </div>
            <LeadFormPanel
              id={id("lead-form")}
              title={vm.copy.formTitle}
              description={vm.copy.formDescription}
              size={vm.template.leadFormSize}
              seal={<CreciSeal vm={vm} />}
            >
              {leadForm}
            </LeadFormPanel>
          </div>
        </Section>
      </main>

      <LandingFooter vm={vm} disclaimer={DISCLAIMERS.property} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
