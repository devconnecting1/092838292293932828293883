import "server-only"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { ListingPublicationSettingsForm } from "@/components/configuracoes/listing-publication-settings-form"
import { TEAM_MANAGER_ROLES, type Role } from "@/lib/auth/roles"
import { getListingPublicationSettings } from "@/lib/imoveis/listing-publication"
import { createClient } from "@/lib/supabase/server"

/**
 * Cartão "Anúncios e página pública" de Configurações → Imobiliária, ao lado do
 * cartão dos portais. Carrega as próprias regras; só dono e gerente editam.
 *
 * Uso na página: `<ListingPublicationSettingsCard organizationId={organization.id} role={membership.role} />`
 */
export async function ListingPublicationSettingsCard({
  organizationId,
  role,
}: {
  organizationId: string
  role: Role
}) {
  const supabase = await createClient()
  const settings = await getListingPublicationSettings(supabase, organizationId)
  const canEdit = TEAM_MANAGER_ROLES.includes(role)

  return (
    <Card id="anuncios" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Anúncios e página pública</CardTitle>
        <CardDescription>
          {canEdit
            ? "Quando um anúncio sai do ar sozinho e o que a página pública de cada imóvel mede."
            : "Somente o dono e o gerente podem alterar estas regras."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ListingPublicationSettingsForm
          canEdit={canEdit}
          defaultValues={{
            hideWithoutValidAuthorization: settings.hideWithoutValidAuthorization,
            publicPagesEnabledByDefault: settings.publicPagesEnabledByDefault,
            metaPixelId: settings.metaPixelId ?? "",
            googleTagId: settings.googleTagId ?? "",
          }}
        />
      </CardContent>
    </Card>
  )
}
