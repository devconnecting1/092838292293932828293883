import { PencilIcon, PlusIcon, SearchIcon } from "lucide-react"

import type { Tables } from "@workspace/database/types"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import { InterestActiveSwitch } from "@/components/clientes/interest-active-switch"
import { InterestFormDialog } from "@/components/clientes/interest-form-dialog"
import { deleteClientInterest } from "@/lib/clientes/interest-actions"
import {
  describeInterestPriceRange,
  describeInterestPurpose,
  describeInterestTypes,
  interestRowToFormValues,
} from "@/lib/clientes/interest-schema"

type InterestsPanelProps = {
  clientId: string
  interests: Tables<"client_interests">[]
  canEdit: boolean
  canDelete: boolean
}

export function InterestsPanel({ clientId, interests, canEdit, canDelete }: InterestsPanelProps) {
  const newButton = canEdit ? (
    <InterestFormDialog clientId={clientId} trigger={<Button />}>
      <PlusIcon data-icon="inline-start" />
      Novo perfil
    </InterestFormDialog>
  ) : null

  if (interests.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum perfil de busca</EmptyTitle>
          <EmptyDescription>
            Registre finalidade, tipos, bairros e faixa de preço para o CRM sugerir imóveis
            compatíveis.
          </EmptyDescription>
        </EmptyHeader>
        {newButton ? <EmptyContent>{newButton}</EmptyContent> : null}
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Perfis ativos alimentam a aba de imóveis compatíveis.
        </p>
        {newButton}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {interests.map((interest) => {
          const location = [interest.neighborhoods.join(", "), interest.city]
            .filter(Boolean)
            .join(" · ")

          return (
            <Card key={interest.id}>
              <CardHeader>
                <CardTitle>
                  {describeInterestPurpose(interest.purpose)} ·{" "}
                  {describeInterestTypes(interest.types)}
                </CardTitle>
                <CardDescription>{location || "Qualquer localização"}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Faixa de preço</dt>
                  <dd>{describeInterestPriceRange(interest.min_price, interest.max_price)}</dd>
                  <dt className="text-muted-foreground">Quartos</dt>
                  <dd>
                    {interest.min_bedrooms === null
                      ? "Indiferente"
                      : `${interest.min_bedrooms} ou mais`}
                  </dd>
                  <dt className="text-muted-foreground">Vagas</dt>
                  <dd>
                    {interest.min_parking === null
                      ? "Indiferente"
                      : `${interest.min_parking} ou mais`}
                  </dd>
                  {interest.notes ? (
                    <>
                      <dt className="text-muted-foreground">Observações</dt>
                      <dd className="wrap-break-word whitespace-pre-wrap">{interest.notes}</dd>
                    </>
                  ) : null}
                </dl>
              </CardContent>
              <CardFooter className="justify-between gap-2">
                <InterestActiveSwitch
                  interestId={interest.id}
                  clientId={clientId}
                  active={interest.active}
                  disabled={!canEdit}
                />
                <div className="flex gap-1">
                  {canEdit ? (
                    <InterestFormDialog
                      clientId={clientId}
                      interest={{
                        id: interest.id,
                        values: interestRowToFormValues(interest),
                      }}
                      trigger={<Button variant="ghost" size="icon-sm" />}
                    >
                      <PencilIcon />
                      <span className="sr-only">Editar perfil de busca</span>
                    </InterestFormDialog>
                  ) : null}
                  {canDelete ? (
                    <ConfirmDeleteButton
                      action={deleteClientInterest.bind(null, interest.id, clientId)}
                      label="Excluir perfil de busca"
                      title="Excluir este perfil de busca?"
                      description="O perfil deixa de gerar sugestões de imóveis. Esta ação não pode ser desfeita."
                    />
                  ) : null}
                </div>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
