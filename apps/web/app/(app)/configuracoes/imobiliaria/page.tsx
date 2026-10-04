import type { Metadata } from "next"
import Link from "next/link"
import { CircleAlertIcon, ExternalLinkIcon, LockIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import { Separator } from "@workspace/ui/components/separator"

import { loadBillingOverview } from "@/components/billing/billing-data"
import { BILLING_STATE_LABELS, planDisplayName } from "@/components/billing/overview-view"
import { BrandForm } from "@/components/configuracoes/brand-form"
import { CopyField } from "@/components/configuracoes/copy-field"
import { FeedPreview } from "@/components/configuracoes/feed-preview"
import { ListingPublicationSettingsCard } from "@/components/configuracoes/listing-publication-settings-card"
import { OrganizationForm } from "@/components/configuracoes/organization-form"
import { RotateFeedTokenButton } from "@/components/configuracoes/rotate-feed-token-button"
import { PageHeading } from "@/components/crm/page-placeholder"
import { OrganizationDeletionCard } from "@/components/exclusao/organization-deletion-card"
import { getInitials } from "@/components/crm/utils"
import { PageShell } from "@/components/shared/page-shell"
import { ORGANIZATION_VIEWER_ROLES } from "@/lib/auth/roles"
import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import { requireRole } from "@/lib/auth/session"
import { HEX_COLOR_PATTERN, isHttpsUrl, readOrganizationBrand } from "@/lib/configuracoes/brand"
import { maskCnpj, maskPhoneBr } from "@/lib/configuracoes/masks"
import { getOrganizationDeletion } from "@/lib/exclusao/queries"
import { loadFeedPreview } from "@/lib/portais/feed-preview"
import { loadFeedSettings } from "@/lib/portais/feed-settings"
import { createClient } from "@/lib/supabase/server"
import { buildCaptureUrl, buildPortalFeedUrl } from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: "Imobiliária",
}

export default async function ImobiliariaPage() {
  const { membership } = await requireRole(ORGANIZATION_VIEWER_ROLES)
  const isOwner = membership.role === "owner"
  const supabase = await createClient()

  // feed_token não entra no SELECT (sem grant): só a RPC get_feed_settings o devolve.
  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id, slug, name, legal_name, cnpj, creci, phone, email, city, state, brand")
    .eq("id", membership.organizationId)
    .maybeSingle()

  if (error || !organization) {
    throw new Error(`Não foi possível carregar a imobiliária (${error?.code ?? "sem-registro"}).`)
  }

  // O plano vem da assinatura (billing_accounts); organizations.plan está obsoleta.
  const billing = await loadBillingOverview(organization.id)
  const planLabel = billing
    ? `${planDisplayName(billing.planKey)} · ${BILLING_STATE_LABELS[billing.state]}`
    : "Indisponível no momento"

  const feedSettings = await loadFeedSettings(supabase, organization.id, membership.role)
  const feedPreview =
    feedSettings.status === "ok"
      ? await loadFeedPreview(supabase, feedSettings.slug, feedSettings.feedToken)
      : null

  // URLs no subdomínio da imobiliária (env + slug validado pelo banco).
  const feed =
    feedSettings.status === "ok" && feedPreview
      ? {
          url: buildPortalFeedUrl(feedSettings.slug, feedSettings.feedToken),
          preview: feedPreview,
        }
      : null
  const brand = readOrganizationBrand(organization.brand)
  // "Excluir a imobiliária": só o dono vê (o banco confere o papel de novo).
  const deletion = isOwner ? await getOrganizationDeletion(organization.id) : null
  const captureUrl = buildCaptureUrl(organization.slug)

  const logoUrl = brand.logoUrl && isHttpsUrl(brand.logoUrl) ? brand.logoUrl : undefined
  const primaryColor =
    brand.primaryColor && HEX_COLOR_PATTERN.test(brand.primaryColor) ? brand.primaryColor : null

  return (
    <PageShell
      variant="settings"
      header={
        <PageHeading
          title="Imobiliária"
          description="Dados cadastrais, marca e integração com os portais."
        />
      }
      rail={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumo da marca</CardTitle>
              <CardDescription>Como a imobiliária aparece no formulário público.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-10">
                  <AvatarImage src={logoUrl} alt="" />
                  <AvatarFallback>{getInitials(organization.name)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{organization.name}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {organization.slug}
                  </span>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Cor</dt>
                <dd className="flex items-center gap-2">
                  {primaryColor ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded-sm border"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <span className="font-mono">{primaryColor}</span>
                    </>
                  ) : (
                    "Padrão do CRM"
                  )}
                </dd>
                <dt className="text-muted-foreground">Logo</dt>
                <dd>{logoUrl ? "Configurado" : "Iniciais da imobiliária"}</dd>
                <dt className="text-muted-foreground">Plano</dt>
                <dd className="min-w-0">
                  <Link
                    href={SUBSCRIPTION_SETTINGS_PATH}
                    className="underline-offset-4 hover:underline"
                  >
                    {planLabel}
                  </Link>
                </dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Links públicos</CardTitle>
              <CardDescription>
                Envie a proprietários que querem anunciar o imóvel com a imobiliária.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="link-captacao">Formulário de captação</FieldLabel>
                <CopyField id="link-captacao" value={captureUrl} />
              </Field>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                render={<a href={captureUrl} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Abrir formulário
              </Button>
            </CardContent>
          </Card>
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Dados cadastrais</CardTitle>
          <CardDescription>
            {isOwner
              ? "Aparecem para a equipe e no cabeçalho do feed dos portais."
              : "Somente o dono da imobiliária pode editar estes dados."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationForm
            canEdit={isOwner}
            slug={organization.slug}
            planLabel={planLabel}
            planHref={SUBSCRIPTION_SETTINGS_PATH}
            defaultValues={{
              name: organization.name,
              legalName: organization.legal_name ?? "",
              cnpj: maskCnpj(organization.cnpj ?? ""),
              creci: organization.creci ?? "",
              phone: maskPhoneBr(organization.phone ?? ""),
              email: organization.email ?? "",
              city: organization.city ?? "",
              state: organization.state ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marca</CardTitle>
          <CardDescription>
            Cor e logo usados no formulário público de captação (
            <a
              href={captureUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {captureUrl.replace(/^https?:\/\//, "")}
            </a>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandForm
            canEdit={isOwner}
            organizationName={organization.name}
            defaultValues={{
              primaryColor: brand.primaryColor ?? "",
              logoUrl: brand.logoUrl ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card id="portais" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Portais: ZAP Imóveis, Viva Real e OLX</CardTitle>
          <CardDescription>
            Um único arquivo para os portais atende os três portais do Grupo OLX.
          </CardDescription>
          {isOwner ? (
            <CardAction>
              <RotateFeedTokenButton />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {feed ? (
            <>
              <Field>
                <FieldLabel htmlFor="feed-url">Endereço do arquivo para os portais</FieldLabel>
                <CopyField
                  id="feed-url"
                  value={feed.url}
                  successMessage="Endereço do arquivo para os portais copiado."
                />
                <FieldDescription>
                  Quem tem este endereço consegue ler os anúncios publicados. Não divulgue fora do
                  Canal Pro.
                </FieldDescription>
              </Field>

              <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm text-muted-foreground">
                <li>Copie o endereço acima.</li>
                <li>
                  No Canal Pro do Grupo OLX, cadastre-o como integração por feed (lá aparece como
                  formato VRSync).
                </li>
                <li>
                  O portal lê o arquivo duas vezes ao dia: mudanças nos imóveis aparecem na leitura
                  seguinte.
                </li>
              </ol>

              <Separator />

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-medium">Prévia do arquivo para os portais</h2>
                  <p className="text-sm text-muted-foreground">
                    Imóveis ativos com a publicação nos portais marcada. Os que não cumprem as
                    regras dos portais ficam de fora até serem corrigidos, sem afetar os demais.
                  </p>
                </div>
                <FeedPreview preview={feed.preview} />
              </div>
            </>
          ) : feedSettings.status === "error" ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>URL do feed indisponível</AlertTitle>
              <AlertDescription>{feedSettings.message}</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <LockIcon />
              <AlertTitle>Só o dono e o gerente veem a URL do feed</AlertTitle>
              <AlertDescription>
                A URL dá acesso aos anúncios enviados aos portais, por isso fica restrita ao dono e
                ao gerente da imobiliária. Se precisar dela ou da prévia do feed, peça a um deles.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <ListingPublicationSettingsCard organizationId={organization.id} role={membership.role} />

      {isOwner ? (
        <OrganizationDeletionCard
          organizationName={organization.name}
          slug={organization.slug}
          status={deletion}
        />
      ) : null}
    </PageShell>
  )
}
