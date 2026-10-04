import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LayoutGridIcon, LockIcon, LogOutIcon, PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { APP_NAME } from "@/components/crm/brand"
import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { signOut } from "@/lib/auth/actions"
import { HOME_PATH, LOGIN_PATH, ONBOARDING_PATH, TENANT_PICKER_PATH } from "@/lib/auth/routes"
import { getOrganizationContext } from "@/lib/auth/session"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { buildAppUrl, isSubdomainTenancy } from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: { absolute: `Sem acesso · ${APP_NAME}` },
  robots: { index: false, follow: false },
}

/**
 * "Você não tem acesso a esta imobiliária". Servida no subdomínio como
 * /sem-acesso (rewrite do proxy) quando o usuário está logado, mas não tem
 * membership ativa na imobiliária do endereço. Não mostra dados da imobiliária.
 */
export default async function SemAcessoPage() {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  const context = await getOrganizationContext()

  if (!context) {
    redirect(LOGIN_PATH)
  }

  // Host único: a imobiliária atual já é uma das do usuário.
  if (!isSubdomainTenancy()) {
    redirect(context.membership ? HOME_PATH : ONBOARDING_PATH)
  }

  // Aberta fora de um subdomínio: não há imobiliária para negar.
  if (!context.tenantSlug) {
    redirect(TENANT_PICKER_PATH)
  }

  if (context.membership) {
    redirect(HOME_PATH)
  }

  const hasOrganizations = context.memberships.length > 0

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Empty className="max-w-lg border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Você não tem acesso a esta imobiliária</EmptyTitle>
          <EmptyDescription>
            {context.user.email ? `A conta ${context.user.email}` : "Sua conta"} não faz parte da
            equipe deste endereço. Se deveria ter acesso, peça um convite ao responsável pela
            imobiliária.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            {hasOrganizations ? (
              <Button render={<a href={buildAppUrl(TENANT_PICKER_PATH)} />} nativeButton={false}>
                <LayoutGridIcon data-icon="inline-start" />
                Ver minhas imobiliárias
              </Button>
            ) : (
              <Button render={<a href={buildAppUrl(ONBOARDING_PATH)} />} nativeButton={false}>
                <PlusIcon data-icon="inline-start" />
                Criar imobiliária
              </Button>
            )}
            <form action={signOut}>
              <Button type="submit" variant="outline">
                <LogOutIcon data-icon="inline-start" />
                Entrar com outra conta
              </Button>
            </form>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}
