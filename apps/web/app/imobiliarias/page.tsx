import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowUpRightIcon, InfoIcon, LogOutIcon, PlusIcon, ShieldCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { APP_NAME, BrandLogo } from "@/components/crm/brand"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { getFirstName, getInitials } from "@/components/crm/utils"
import { enterOrganization, signOut } from "@/lib/auth/actions"
import { ROLE_LABELS } from "@/lib/auth/roles"
import {
  HOME_PATH,
  isRootOnlyPath,
  ONBOARDING_PATH,
  PLATFORM_ADMIN_PATH_PREFIX,
  sanitizeRedirectPath,
} from "@/lib/auth/routes"
import { getOrganizationContext, requireUser } from "@/lib/auth/session"
import { canOpenPlatformConsole } from "@/lib/plataforma/admin"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import {
  buildTenantUrl,
  isValidTenantSlug,
  supportsSharedSessionCookies,
  tryGetRootDomain,
} from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: { absolute: `Suas imobiliárias · ${APP_NAME}` },
  robots: { index: false, follow: false },
}

type ImobiliariasPageProps = {
  searchParams: Promise<{ next?: string | string[] }>
}

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null
}

/**
 * Escolha de imobiliária.
 * - Modo subdomain (domínio raiz): cada imobiliária abre no próprio subdomínio;
 *   com uma só, vai direto. O proxy manda para cá as rotas do CRM acessadas na
 *   raiz (com `next` para abrir a mesma seção).
 * - Modo single-host: grava a escolha no cookie (validado no servidor).
 */
export default async function ImobiliariasPage({ searchParams }: ImobiliariasPageProps) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  const [user, params] = await Promise.all([requireUser(), searchParams])
  const [context, showPlatformConsole] = await Promise.all([
    getOrganizationContext(),
    canOpenPlatformConsole(user.email),
  ])
  const memberships = context?.memberships ?? []

  if (memberships.length === 0) {
    // Conta só da equipe da plataforma: vai ao console em vez de criar imobiliária.
    redirect(showPlatformConsole ? PLATFORM_ADMIN_PATH_PREFIX : ONBOARDING_PATH)
  }

  const requested = sanitizeRedirectPath(readParam(params.next), HOME_PATH)
  const next = isRootOnlyPath(requested) ? HOME_PATH : requested
  const rootDomain = tryGetRootDomain()
  const [only] = memberships

  if (memberships.length === 1 && only && isValidTenantSlug(only.organization.slug)) {
    // Com uma só imobiliária não há o que escolher (no host único ela já é a atual).
    redirect(rootDomain ? buildTenantUrl(only.organization.slug, next) : next)
  }

  const firstName = getFirstName(user.fullName)
  const showLocalNotice = rootDomain !== null && !supportsSharedSessionCookies()
  const currentId = rootDomain ? null : (context?.membership?.organizationId ?? null)

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between gap-4 p-4 md:px-10 md:py-6">
        <BrandLogo />
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOutIcon data-icon="inline-start" />
            Sair
          </Button>
        </form>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-10 md:items-center">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Suas imobiliárias</CardTitle>
            <CardDescription>
              {firstName ? `${firstName}, escolha` : "Escolha"} em qual imobiliária você quer
              entrar.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {showLocalNotice ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>Ambiente local</AlertTitle>
                <AlertDescription>
                  Em localhost o login não é compartilhado entre endereços: ao abrir uma
                  imobiliária, entre novamente com a mesma conta.
                </AlertDescription>
              </Alert>
            ) : null}
            <ItemGroup className="gap-2">
              {memberships.map((membership) => {
                const { slug, name } = membership.organization
                const isReachable = isValidTenantSlug(slug)
                const isCurrent = membership.organizationId === currentId
                const address = rootDomain ? `${slug}.${rootDomain}` : null

                return (
                  <Item key={membership.organizationId} variant="outline">
                    <ItemMedia>
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                        {getInitials(name)}
                      </div>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="truncate">
                        {name}
                        {isCurrent ? <Badge variant="secondary">Atual</Badge> : null}
                      </ItemTitle>
                      <ItemDescription className="truncate">
                        {ROLE_LABELS[membership.role]}
                        {address ? ` · ${isReachable ? address : "endereço indisponível"}` : ""}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {!isReachable ? null : rootDomain ? (
                        <Button
                          size="sm"
                          render={<a href={buildTenantUrl(slug, next)} />}
                          nativeButton={false}
                        >
                          Abrir
                          <ArrowUpRightIcon data-icon="inline-end" />
                        </Button>
                      ) : (
                        <form
                          action={enterOrganization.bind(null, membership.organizationId, next)}
                        >
                          <Button
                            type="submit"
                            size="sm"
                            variant={isCurrent ? "outline" : "default"}
                          >
                            Abrir
                          </Button>
                        </form>
                      )}
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
            {showPlatformConsole ? (
              <Item variant="muted">
                <ItemMedia>
                  <div className="flex size-9 items-center justify-center rounded-lg border bg-background">
                    <ShieldCheckIcon />
                  </div>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">Console da Plataforma</ItemTitle>
                  <ItemDescription className="truncate">
                    Área de desenvolvedor, só para a equipe da plataforma
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={PLATFORM_ADMIN_PATH_PREFIX} />}
                    nativeButton={false}
                  >
                    Abrir
                  </Button>
                </ItemActions>
              </Item>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={ONBOARDING_PATH} />}
              nativeButton={false}
            >
              <PlusIcon data-icon="inline-start" />
              Nova imobiliária
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}
