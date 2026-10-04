import Link from "next/link"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, MessageCircleIcon } from "lucide-react"

import {
  ADDONS,
  LIMITS,
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  PLANS,
  TRIAL_BASE_PLAN,
  TRIAL_DAYS,
} from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Toaster } from "@workspace/ui/components/toast"

import { AddonsList } from "@/components/billing/addons-list"
import { PlanComparison } from "@/components/billing/plan-comparison"
import { PlanConditions } from "@/components/billing/plan-conditions"
import type { CatalogPrices } from "@/components/billing/plan-content"
import { PlanRecommender } from "@/components/billing/plan-recommender"
import { PlansFaq } from "@/components/billing/plans-faq"
import type { PricingAccount } from "@/components/billing/pricing-account"
import { PricingAccountNav } from "@/components/billing/pricing-account-nav"
import { PricingAccountSummary } from "@/components/billing/pricing-account-summary"
import { PricingIntervalSwitch, PricingPlans } from "@/components/billing/pricing-plans"
import { PricingProvider } from "@/components/billing/pricing-provider"
import { APP_NAME, BrandMark } from "@/components/crm/brand"
import { getSupportContact, type SupportContact } from "@/components/crm/support"
import { LOGIN_PATH, PLANS_PATH, SIGN_UP_PATH } from "@/lib/auth/routes"

type PricingPageProps = {
  prices: CatalogPrices
  /** null: visitante (versão estática). */
  account: PricingAccount | null
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  const headingId = `${id}-titulo`

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-7xl scroll-mt-16 flex-col gap-8 px-4 py-12 lg:px-6 lg:py-16"
    >
      <div className="flex flex-col gap-2 text-center">
        <h2
          id={headingId}
          className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
        >
          {title}
        </h2>
        {description ? (
          <p className="mx-auto max-w-2xl text-balance text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function PricingHeader({ account }: { account: PricingAccount | null }) {
  const brand = (
    <>
      <BrandMark />
      <span className={account ? "hidden sm:inline" : undefined}>{APP_NAME}</span>
    </>
  )

  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 lg:px-6">
        {account ? (
          <a
            href={account.panelHref}
            aria-label={`${APP_NAME}: voltar ao painel`}
            className="flex shrink-0 items-center gap-2 rounded-md font-medium"
          >
            {brand}
          </a>
        ) : (
          <Link
            href="/"
            aria-label={`${APP_NAME}: página inicial`}
            className="flex shrink-0 items-center gap-2 rounded-md font-medium"
          >
            {brand}
          </Link>
        )}

        {account ? (
          <PricingAccountNav account={account} />
        ) : (
          <nav aria-label="Acesso" className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href={LOGIN_PATH} />} nativeButton={false}>
              Entrar
            </Button>
            <Button render={<Link href={SIGN_UP_PATH} />} nativeButton={false}>
              <span className="sm:hidden">Testar grátis</span>
              <span className="hidden sm:inline">Começar teste grátis</span>
            </Button>
          </nav>
        )}
      </div>
    </header>
  )
}

/** Faixa do plano Rede: várias lojas e atendimento dedicado, só com o que o catálogo oferece. */
function NetworkBand({ support }: { support: SupportContact | null }) {
  const rede = PLANS.rede
  const branchAddon = ADDONS.find((addon) => addon.key === "branch")
  const items = [
    {
      text: `Até ${rede.limits.branches} lojas ou imobiliárias no plano ${rede.name}`,
      soon: LIMITS.branches.status === "soon",
    },
    ...(branchAddon
      ? [
          {
            text: `${branchAddon.name}: ${branchAddon.priceLabel}`,
            soon: branchAddon.status === "soon",
          },
        ]
      : []),
    { text: `Suporte humano com ${rede.support.toLowerCase()}`, soon: false },
  ]

  return (
    <Card>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-10">
        <div className="flex flex-col gap-1">
          <h2 id="rede-titulo" className="text-lg font-medium">
            Várias lojas ou uma rede?
          </h2>
          <p className="text-muted-foreground">{rede.description}</p>
        </div>
        <ul className="flex flex-col gap-2" aria-labelledby="rede-titulo">
          {items.map((item) => (
            <li key={item.text} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {item.text}
                {item.soon ? <Badge variant="outline">Em breve</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          {support ? (
            <Button
              render={<a href={support.href} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <MessageCircleIcon data-icon="inline-start" />
              Fale com a gente
              <span className="sr-only"> (abre em nova aba)</span>
            </Button>
          ) : null}
          <Button variant="outline" render={<a href="#comparativo" />} nativeButton={false}>
            Comparar o plano {rede.name}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Página de planos, igual para visitante e para quem entrou: título curto,
 * alternador Mensal/Anual, 4 cartões, faixa do Rede, recomendador, adicionais,
 * comparativo com cabeçalho fixo, condições, perguntas e chamada final. Com
 * conta, o cabeçalho mostra a imobiliária e os botões assinam ou trocam o plano.
 */
export function PricingPage({ prices, account }: PricingPageProps) {
  const support = getSupportContact({ pathname: PLANS_PATH })

  return (
    <Toaster>
      <PricingProvider prices={prices} account={account}>
        <div className="flex min-h-svh flex-col bg-background">
          <a
            href="#conteudo"
            className="sr-only rounded-lg bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:z-40 focus:ring-3 focus:ring-ring/50"
          >
            Pular para o conteúdo
          </a>

          <PricingHeader account={account} />

          <main id="conteudo" tabIndex={-1} className="flex flex-1 flex-col outline-none">
            <section
              id="planos"
              aria-labelledby="planos-titulo"
              className="mx-auto flex w-full max-w-7xl scroll-mt-16 flex-col gap-8 px-4 pt-12 pb-12 lg:px-6 lg:pt-16"
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <h1
                  id="planos-titulo"
                  className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
                >
                  Um plano para cada tamanho de operação
                </h1>
                <p className="max-w-3xl text-balance text-muted-foreground sm:text-lg">
                  {account
                    ? "Upgrade na hora, com cobrança proporcional. Downgrade no próximo ciclo, sem apagar nada."
                    : `Teste os recursos do plano ${PLANS[TRIAL_BASE_PLAN].name} por ${TRIAL_DAYS} dias, sem cartão. A IA começa quando você assina.`}
                </p>
              </div>

              <PricingAccountSummary />
              <PricingIntervalSwitch />
              <PricingPlans />

              <p className="text-center text-sm text-balance text-muted-foreground">
                Valores em reais. Clientes e condomínios sem limite em todos os planos; imóveis{" "}
                {OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT}, sem foto ou só com fotos no site de
                origem não contam no limite de imóveis com foto, que cresce com pacotes de +10
                imóveis. Itens “Em breve” ainda estão em construção e chegam sem custo extra para
                quem já tem o plano.
              </p>

              <NetworkBand support={support} />
            </section>

            <Separator />

            <Section
              id="recomendador"
              title="Qual plano combina com você?"
              description="Responda três perguntas e veja o plano de menor custo que atende a sua equipe e os seus imóveis com foto, o total por mês e quanto economiza no anual."
            >
              <PlanRecommender prices={prices} />
            </Section>

            <Separator />

            <Section
              id="adicionais"
              title="Adicionais"
              description="Extras para quando a operação crescer. Os pacotes de imóveis com foto já podem ser contratados; os demais chegam em breve, com estes preços."
            >
              <AddonsList />
            </Section>

            <Separator />

            <Section
              id="comparativo"
              title="Compare os planos"
              description="Todos os limites e recursos, lado a lado. O ícone de informação mostra a regra de cada linha."
            >
              <PlanComparison />
            </Section>

            <Separator />

            <Section id="condicoes" title="Condições em linguagem simples">
              <PlanConditions />
            </Section>

            <Separator />

            <Section id="perguntas" title="Perguntas frequentes">
              <div className="mx-auto w-full max-w-3xl">
                <PlansFaq />
              </div>
            </Section>

            <section aria-labelledby="cta-titulo" className="border-t">
              <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
                {account ? (
                  <>
                    <h2
                      id="cta-titulo"
                      className="text-2xl font-semibold tracking-tight text-balance"
                    >
                      Ficou com alguma dúvida sobre os planos?
                    </h2>
                    <p className="text-balance text-muted-foreground">
                      A mudança de plano não apaga nada do que você cadastrou.
                    </p>
                    <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
                      {support ? (
                        <Button
                          size="lg"
                          render={
                            <a href={support.href} target="_blank" rel="noopener noreferrer" />
                          }
                          nativeButton={false}
                        >
                          <MessageCircleIcon data-icon="inline-start" />
                          Fale com a gente
                          <span className="sr-only"> (abre em nova aba)</span>
                        </Button>
                      ) : null}
                      <Button
                        size="lg"
                        variant={support ? "outline" : "default"}
                        render={<a href={account.panelHref} />}
                        nativeButton={false}
                      >
                        <ArrowLeftIcon data-icon="inline-start" />
                        Voltar ao painel
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2
                      id="cta-titulo"
                      className="text-2xl font-semibold tracking-tight text-balance"
                    >
                      Comece hoje e responda o próximo lead a tempo.
                    </h2>
                    <p className="text-balance text-muted-foreground">
                      {TRIAL_DAYS} dias grátis, sem cartão. Se não for para você, é só não assinar.
                    </p>
                    <Button size="lg" render={<Link href={SIGN_UP_PATH} />} nativeButton={false}>
                      Começar teste grátis
                      <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                  </>
                )}
              </div>
            </section>
          </main>

          <footer className="border-t">
            <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row lg:px-6">
              <p>© {APP_NAME}. Preços em reais (BRL).</p>
              <nav aria-label="Rodapé" className="flex items-center gap-4">
                {account ? (
                  <a href={account.panelHref} className="underline-offset-4 hover:underline">
                    Voltar ao painel
                  </a>
                ) : (
                  <>
                    <Link href={LOGIN_PATH} className="underline-offset-4 hover:underline">
                      Entrar
                    </Link>
                    <Link href={SIGN_UP_PATH} className="underline-offset-4 hover:underline">
                      Criar conta
                    </Link>
                  </>
                )}
              </nav>
            </div>
          </footer>
        </div>
      </PricingProvider>
    </Toaster>
  )
}
