import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { ConsentPreferences } from "@/components/leads-publicos/consent-preferences"
import { formatPhoneDisplay } from "@/lib/captacao/masks"
import { getPublicOrganization, publicCreciLabel } from "@/lib/captacao/public-organization"
import { LANDING_NOT_FOUND_METADATA } from "@/lib/leads-publicos/metadata"
import { getPublicLandingPage } from "@/lib/leads-publicos/queries"
import { safeGoogleTagId, safeMetaPixelId } from "@/lib/leads-publicos/tracking-ids"
import { buildLandingPagePath } from "@/lib/tenant/urls"

export const revalidate = 60

type LandingPrivacyPageProps = {
  params: Promise<{ org: string; page: string }>
}

/** CRECI J da imobiliária ou, sem ele, o CRECI F do dono (corretor autônomo). */
async function responsibleCreciLabel(orgSlug: string, creci: string | null | undefined) {
  if (creci?.trim()) {
    return publicCreciLabel({ creci, ownerCreci: null })
  }

  try {
    const organization = await getPublicOrganization(orgSlug)
    return organization ? publicCreciLabel(organization) : null
  } catch {
    // Rótulo acessório: sem ele a página de privacidade continua completa.
    return null
  }
}

export async function generateMetadata({ params }: LandingPrivacyPageProps): Promise<Metadata> {
  const { org, page } = await params
  const landing = await getPublicLandingPage(org, page)

  if (!landing) {
    return LANDING_NOT_FOUND_METADATA
  }

  return {
    title: {
      absolute: `Privacidade e cookies | ${landing.payload.organization.name}`,
    },
    robots: { index: false, follow: true },
  }
}

export default async function LandingPrivacyPage({ params }: LandingPrivacyPageProps) {
  const { org, page } = await params
  const landing = await getPublicLandingPage(org, page)

  if (!landing) {
    notFound()
  }

  const { payload, orgSlug, pageSlug } = landing
  const { organization } = payload
  const pageLabel = payload.page.content.headline ?? payload.page.name
  const phone = formatPhoneDisplay(organization.phone)
  const contacts = [organization.email, phone].filter(Boolean).join(" · ")
  const creciLabel = await responsibleCreciLabel(orgSlug, organization.creci)
  // Os mesmos rastreadores que LandingTracking carrega (o GTM não é carregado).
  const hasTrackers = Boolean(
    safeMetaPixelId(payload.page.tracking.meta_pixel_id) ||
    safeGoogleTagId(payload.page.tracking.google_tag_id)
  )

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        // Caminho no host em que a página é servida (curto no subdomínio, longo no host único).
        render={<Link href={buildLandingPagePath(orgSlug, pageSlug)} />}
        nativeButton={false}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Voltar para a página
      </Button>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Privacidade e cookies
        </h1>
        <p className="text-pretty text-muted-foreground">
          Como {organization.name} usa os dados enviados pela página “{pageLabel}”.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quem cuida dos seus dados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            {organization.name}
            {creciLabel ? ` (${creciLabel})` : ""} é a responsável pelos dados enviados por esta
            página.
          </p>
          <p className="text-muted-foreground">
            {contacts
              ? `Para falar sobre seus dados: ${contacts}.`
              : "Para falar sobre seus dados, use os canais de atendimento da imobiliária."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados do formulário</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Nome, telefone ou WhatsApp e, se você informar, e-mail, interesse, imóvel ou tipologia e
            mensagem. Eles são usados para retornar o seu contato e prestar o atendimento
            imobiliário, com base no consentimento que você dá ao marcar a autorização no formulário
            (art. 7º, I, da LGPD).
          </p>
          <p className="text-muted-foreground">
            Para evitar envios abusivos, usamos um código calculado a partir do seu endereço IP, sem
            guardar o IP.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Origem do contato</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Para saber qual campanha trouxe você até aqui, a página guarda em cookies próprios os
            parâmetros da campanha (utm) por 30 minutos e os identificadores de clique de anúncios
            (gclid, gbraid, wbraid e fbclid) por 90 dias, e os envia junto com o formulário, com o
            endereço da página de origem (sem parâmetros). Esse uso se baseia no legítimo interesse
            da imobiliária em medir as próprias campanhas (art. 7º, IX, da LGPD).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cookies de medição</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {hasTrackers ? (
            <>
              <p>
                Cookies de parceiros (Meta Pixel e Google tag) só são ativados se você aceitar. A
                escolha fica guardada por 180 dias e pode ser alterada aqui a qualquer momento.
              </p>
              <ConsentPreferences />
            </>
          ) : (
            <p>Esta página não usa cookies de medição de parceiros.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seus direitos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Pela LGPD (art. 18), você pode pedir a confirmação do tratamento, o acesso, a correção,
            a anonimização ou a eliminação dos seus dados, informações sobre compartilhamento e a
            revogação do consentimento. Faça o pedido diretamente a {organization.name}
            {contacts ? ` (${contacts})` : ""}.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
