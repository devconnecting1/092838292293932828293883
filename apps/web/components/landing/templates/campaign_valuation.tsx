import { HighlightList } from "../sections/highlights"
import { AboutOrganization } from "../sections/about-organization"
import { HeroBackdrop } from "../sections/hero-backdrop"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { Section, SectionHeading } from "../sections/primitives"
import { SocialProof, hasSocialProof } from "../sections/social-proof"
import { Steps } from "../sections/steps"
import { CreciSeal } from "../sections/trust"
import { ClosingCta, type LandingTemplateRenderProps } from "./shared"

const DEFAULT_GUARANTEES = [
  "Avaliação sem custo",
  "Sem compromisso de anunciar",
  "Seus dados não são compartilhados com terceiros",
]

/**
 * Avaliação gratuita — o formulário é o hero.
 * Proprietário decide rápido ou não decide: título calmo em sans, garantias
 * logo abaixo e o formulário na mesma dobra. Depois, o passo a passo em
 * trilha numerada (sequência real) e quem é a imobiliária.
 */
export function CampaignValuationTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const guarantees = vm.highlights.length > 0 ? vm.highlights : DEFAULT_GUARANTEES
  const steps = [
    {
      title: "Conte sobre o imóvel",
      description:
        "Informe endereço, tamanho e características no formulário. Leva cerca de dois minutos.",
    },
    {
      title: "Receba a visita de um corretor",
      description: `Um corretor da ${vm.organization.name} agenda um horário para conhecer o imóvel de perto.`,
    },
    {
      title: "Saiba o valor de mercado",
      description:
        "Você recebe o valor sugerido para venda ou locação, com base em negócios recentes da região.",
    },
  ]

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="solid" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate overflow-hidden text-(--lp-on-scrim)"
        >
          <HeroBackdrop
            imageUrl={vm.theme.images.background}
            scrim="left"
            mode={mode}
            fallbackLabel="Imagem de fundo"
          />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 @3xl:px-8 @3xl:py-20 @5xl:grid-cols-[minmax(0,1fr)_26rem] @5xl:items-center @5xl:gap-16">
            <div className="flex flex-col gap-6">
              <h1
                id={id("hero-title")}
                className="max-w-[16ch] text-[2.5rem] leading-[1.02] font-semibold tracking-tight text-balance @xl:text-[3.25rem] @5xl:text-[3.75rem]"
              >
                {vm.copy.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-pretty">{vm.copy.subheadline}</p>
              <HighlightList items={guarantees} tone="scrim" className="pt-2" />
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

        {hasSocialProof(vm.socialProof, vm.testimonials) ? (
          <Section tone="alt" labelledBy={id("proof-title")}>
            <SocialProof
              headingId={id("proof-title")}
              title="Proprietários que avaliaram com a gente"
              stats={vm.socialProof}
              testimonials={vm.testimonials}
            />
          </Section>
        ) : null}

        <Section labelledBy={id("steps-title")}>
          <div className="flex flex-col gap-12">
            <SectionHeading
              id={id("steps-title")}
              title="Como funciona a avaliação"
              description="Três etapas, sem custo e sem compromisso de anunciar."
            />
            <Steps steps={steps} />
          </div>
        </Section>

        <Section tone="alt" labelledBy={id("about-title")}>
          <AboutOrganization
            headingId={id("about-title")}
            title={`Sobre a ${vm.organization.name}`}
            organization={vm.organization}
            description={vm.description}
            highlights={[]}
          />
        </Section>

        <ClosingCta
          headingId={id("closing-title")}
          title="Pronto para saber quanto vale o seu imóvel?"
          formHref={formHref}
          ctaLabel={vm.copy.ctaLabel}
        />
      </main>

      <LandingFooter vm={vm} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
