import { MapPinIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { Countdown } from "../sections/countdown"
import { HeroBackdrop } from "../sections/hero-backdrop"
import { HighlightList } from "../sections/highlights"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { Section, SectionHeading, lpDisplayFont, lpSerifFont } from "../sections/primitives"
import { CreciSeal, UnitsLeft } from "../sections/trust"
import { DISCLAIMERS, PreviewHint, type LandingTemplateRenderProps } from "./shared"

/**
 * Lista VIP — uma tela, uma ação.
 * Fundo escuro, nome do empreendimento em destaque, e a contagem regressiva em
 * dígitos condensados enormes como peça central. Formulário curto na mesma
 * dobra. Abaixo, só as vantagens de entrar primeiro.
 */
export function LaunchWaitlistTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="overlay" showCta={false} />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate overflow-hidden text-(--lp-on-scrim)"
        >
          <HeroBackdrop
            imageUrl={vm.theme.images.background}
            mode={mode}
            fallbackLabel="Imagem de fundo"
          />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-28 pb-14 @3xl:px-8 @3xl:pt-36 @5xl:min-h-[44rem] @5xl:grid-cols-[minmax(0,1fr)_24rem] @5xl:items-center @5xl:gap-16 @5xl:pb-24">
            <div className="flex flex-col gap-6">
              {vm.launch.name ? (
                <p
                  className={cn(
                    lpSerifFont,
                    "text-[1.75rem] leading-tight font-medium @xl:text-[2.25rem]"
                  )}
                >
                  {vm.launch.name}
                </p>
              ) : null}
              <h1
                id={id("hero-title")}
                className={cn(
                  lpDisplayFont,
                  "max-w-[20ch] text-[2.25rem] leading-[1.02] font-bold tracking-tight text-balance @xl:text-[3rem] @5xl:text-[3.5rem]"
                )}
              >
                {vm.copy.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-pretty">{vm.copy.subheadline}</p>
              {vm.launch.place ? (
                <p className="flex items-center gap-2 text-sm font-medium">
                  <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
                  {vm.launch.place}
                </p>
              ) : null}
              <UnitsLeft label={vm.unitsLeftLabel} />

              {vm.countdownUntil ? (
                <Countdown
                  until={vm.countdownUntil}
                  caption="As vendas abrem em"
                  expiredMessage="As vendas já começaram. Cadastre-se para receber a tabela com as unidades disponíveis."
                  tone="scrim"
                  className="border-t border-current/40 pt-6"
                />
              ) : (
                <PreviewHint mode={mode}>
                  Defina a data de abertura das vendas no editor para exibir a contagem regressiva.
                </PreviewHint>
              )}
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
        </section>

        {vm.highlights.length > 0 ? (
          <Section labelledBy={id("benefits-title")}>
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:gap-16">
              <SectionHeading
                id={id("benefits-title")}
                title="Por que entrar na lista agora"
                description="Quem se cadastra antes da abertura recebe as informações primeiro."
              />
              <HighlightList items={vm.highlights} variant="statements" />
            </div>
          </Section>
        ) : mode === "preview" ? (
          <Section>
            <PreviewHint mode={mode}>
              Adicione as vantagens de quem entra primeiro na lista.
            </PreviewHint>
          </Section>
        ) : null}
      </main>

      <LandingFooter vm={vm} disclaimer={DISCLAIMERS.launch} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
