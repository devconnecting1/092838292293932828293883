import type { Metadata } from "next"
import { cookies } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { Suspense } from "react"

import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Toaster } from "@workspace/ui/components/toast"

import { SubscriptionBanner } from "@/components/billing/subscription-banner"
import { APP_NAME } from "@/components/crm/brand"
import { CrmHeader } from "@/components/crm/crm-header"
import { CrmLoadError } from "@/components/crm/crm-load-error"
import { CrmSidebar } from "@/components/crm/crm-sidebar"
import { OrganizationDeletionBanner } from "@/components/exclusao/organization-deletion-banner"
import { PlatformAnnouncementBanner } from "@/components/crm/platform-announcement-banner"
import { StatusIncidentBanner } from "@/components/crm/status-incident-banner"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { ServiceWorkerRegistration } from "@/components/push/service-worker-registration"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { PLATFORM_ADMIN_PATH_PREFIX } from "@/lib/auth/routes"
import { requireMembership, type MembershipContext } from "@/lib/auth/session"
import { canOpenPlatformConsole } from "@/lib/plataforma/admin"
import { getDisplayPreferences } from "@/lib/preferencias/display"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import {
  buildTenantOrigin,
  getAppOrigin,
  getTenancyMode,
  isValidTenantSlug,
} from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: {
    template: `%s · ${APP_NAME}`,
    default: APP_NAME,
  },
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  // A imobiliária vem do subdomínio (modo subdomain: header do proxy conferido
  // com o Host) ou do cookie validado (modo single-host), e precisa de
  // membership ativa. Ver requireMembership para os redirecionamentos. Páginas
  // e Server Actions repetem a checagem (layouts não re-renderizam em
  // navegação no cliente).
  // O error.tsx deste grupo não cobre erros deste layout, por isso o try/catch;
  // unstable_rethrow devolve ao Next os redirects e sinais internos.
  let context: MembershipContext

  try {
    context = await requireMembership()
  } catch (error) {
    unstable_rethrow(error)
    console.error(
      "[crm] falha ao carregar as imobiliárias do usuário:",
      error instanceof Error ? error.message : "erro desconhecido"
    )
    return <CrmLoadError />
  }

  const { user, membership, memberships } = context
  const cookieStore = await cookies()
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"
  const tenancyMode = getTenancyMode()
  const isSubdomain = tenancyMode === "subdomain"
  // Host único: links relativos (evita trocar de host em deploys de preview).
  const appOrigin = isSubdomain ? getAppOrigin() : ""
  // Equipe da plataforma: atalho para o Console no menu de imobiliárias.
  const [canOpenConsole, display] = await Promise.all([
    canOpenPlatformConsole(user.email),
    getDisplayPreferences(user.id),
  ])
  const platformConsoleHref = canOpenConsole ? `${appOrigin}${PLATFORM_ADMIN_PATH_PREFIX}` : null

  return (
    <Toaster>
      {/* "Letra e botões maiores" (Meu perfil): o CSS global aumenta a página inteira. */}
      {display.largeText ? <span data-ui-size="grande" hidden /> : null}
      <SidebarProvider defaultOpen={sidebarOpen}>
        <CrmSidebar
          role={membership.role}
          currentOrganizationId={membership.organizationId}
          tenancyMode={tenancyMode}
          appOrigin={appOrigin}
          platformConsoleHref={platformConsoleHref}
          organizations={memberships.map((item) => ({
            id: item.organizationId,
            name: item.organization.name,
            roleLabel: ROLE_LABELS[item.role],
            origin:
              isSubdomain && isValidTenantSlug(item.organization.slug)
                ? buildTenantOrigin(item.organization.slug)
                : null,
          }))}
          user={{
            name: user.fullName ?? user.email ?? "Usuário",
            email: user.email,
            avatarUrl: user.avatarUrl,
          }}
        />
        {/*
          min-w-0: sem ele, a área principal (item flex ao lado da barra lateral)
          cresce até a largura mínima do conteúdo. O quadro de leads, com as
          colunas lado a lado, esticava a página inteira em vez de rolar só dentro
          do quadro, e o conteúdo passava por baixo da barra lateral.
        */}
        <SidebarInset className="min-w-0">
          {/* Sem contato do suporte configurado, só a equipe da plataforma vê o aviso. */}
          <CrmHeader
            supportSetupHref={platformConsoleHref ? `${platformConsoleHref}/saude` : null}
          />
          {/* Exclusão da imobiliária agendada: explica o modo leitura e leva ao cancelamento. */}
          <Suspense fallback={null}>
            <OrganizationDeletionBanner
              organizationId={membership.organizationId}
              role={membership.role}
            />
          </Suspense>
          {/* Avisos de assinatura e da plataforma: não bloqueiam a página nem quebram se a RPC falhar. */}
          <Suspense fallback={null}>
            <SubscriptionBanner organizationId={membership.organizationId} role={membership.role} />
          </Suspense>
          <Suspense fallback={null}>
            <PlatformAnnouncementBanner role={membership.role} />
          </Suspense>
          {/* Incidente ou manutenção em andamento na página de status pública. */}
          <Suspense fallback={null}>
            <StatusIncidentBanner />
          </Suspense>
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      {/* Service worker só nas rotas logadas: push no celular, sem cache de páginas. */}
      <ServiceWorkerRegistration />
    </Toaster>
  )
}
