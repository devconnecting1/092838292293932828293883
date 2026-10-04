import Link from "next/link"
import { MailIcon, MessageCircleIcon, PencilIcon, PhoneIcon } from "lucide-react"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
import type { Tables } from "@workspace/database/types"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { DeleteClientButton } from "@/components/clientes/delete-client-button"
import { getInitials } from "@/components/crm/utils"
import { SubjectErasureButton } from "@/components/lixeira/subject-erasure-button"
import { CLIENTS_PATH, getClientSourceLabel } from "@/lib/clientes/constants"
import { formatPhone, mailtoHref, telHref, whatsappHref } from "@/lib/clientes/format"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"

type ClientHeaderProps = {
  client: Tables<"clients">
  members: MemberOption[]
  canEdit: boolean
  canDelete: boolean
}

export function ClientHeader({ client, members, canEdit, canDelete }: ClientHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <Avatar className="size-12">
          <AvatarFallback>{getInitials(client.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight wrap-break-word">{client.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <Badge variant="outline">{CLIENT_KIND_LABELS[client.kind]}</Badge>
              {client.kind === "pj" && client.trade_name ? <span>{client.trade_name}</span> : null}
              <span>
                Responsável:{" "}
                <span className="text-foreground">
                  {client.assigned_to
                    ? getMemberName(members, client.assigned_to)
                    : "sem responsável"}
                </span>
              </span>
              <span>
                Origem:{" "}
                <span className="text-foreground">{getClientSourceLabel(client.source)}</span>
              </span>
            </div>
          </div>
          {client.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1" aria-label="Etiquetas">
              {client.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="secondary">{tag}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          {client.phone || client.whatsapp || client.email ? (
            <div className="flex flex-wrap gap-2">
              {client.phone ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href={telHref(client.phone)} />}
                  nativeButton={false}
                >
                  <PhoneIcon data-icon="inline-start" />
                  {formatPhone(client.phone)}
                </Button>
              ) : null}
              {client.whatsapp ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href={whatsappHref(client.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  nativeButton={false}
                >
                  <MessageCircleIcon data-icon="inline-start" />
                  WhatsApp {formatPhone(client.whatsapp)}
                </Button>
              ) : null}
              {client.email ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href={mailtoHref(client.email)} />}
                  nativeButton={false}
                >
                  <MailIcon data-icon="inline-start" />
                  {client.email}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {canEdit || canDelete ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit ? (
            <Button
              variant="outline"
              render={<Link href={`${CLIENTS_PATH}/${client.id}/editar`} />}
              nativeButton={false}
            >
              <PencilIcon data-icon="inline-start" />
              Editar
            </Button>
          ) : null}
          {canDelete ? <DeleteClientButton clientId={client.id} /> : null}
          {canDelete ? (
            <SubjectErasureButton
              entity="client"
              recordId={client.id}
              name={client.name}
              redirectTo={CLIENTS_PATH}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
