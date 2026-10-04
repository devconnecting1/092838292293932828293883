import Link from "next/link"
import { MessageCircleIcon, PanelRightOpenIcon, PhoneIcon } from "lucide-react"

import { isValidPhoneBr } from "@workspace/core/br/documents"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { MobileCard, MobileCardList } from "@/components/mobile-cards/mobile-card"
import { formatDate } from "@/lib/format"
import { CLIENTS_PATH, getClientSourceLabel } from "@/lib/clientes/constants"
import { formatPhone, maskClientDocument, telHref, whatsappHref } from "@/lib/clientes/format"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import type { ClientListRow } from "@/lib/clientes/queries"

const MAX_VISIBLE_TAGS = 3

type ClientsTableProps = {
  rows: ClientListRow[]
  members: MemberOption[]
}

function ClientTags({ tags }: { tags: string[] }) {
  const hiddenTags = tags.length - MAX_VISIBLE_TAGS

  return (
    <>
      {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
      {hiddenTags > 0 ? <Badge variant="outline">+{hiddenTags}</Badge> : null}
    </>
  )
}

export function ClientsTable({ rows, members }: ClientsTableProps) {
  return (
    <>
      <div className="overflow-hidden rounded-lg border max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Etiquetas</TableHead>
              <TableHead className="text-end">Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((client) => {
              const phone = client.phone ?? client.whatsapp

              return (
                <TableRow key={client.id}>
                  <TableCell className="max-w-64">
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`${CLIENTS_PATH}/${client.id}`}
                        className="flex min-w-0 items-center font-medium underline-offset-4 hover:underline"
                      >
                        <span className="truncate">{client.name}</span>
                      </Link>
                      {client.kind === "pj" && client.trade_name ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {client.trade_name}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{client.kind === "pf" ? "PF" : "PJ"}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {maskClientDocument(client.kind, client.document)}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{client.email ?? "—"}</span>
                      {phone ? (
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          {formatPhone(phone)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {client.assigned_to ? (
                      getMemberName(members, client.assigned_to)
                    ) : (
                      <span className="text-muted-foreground">Sem responsável</span>
                    )}
                  </TableCell>
                  <TableCell>{getClientSourceLabel(client.source)}</TableCell>
                  <TableCell>
                    {client.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        <ClientTags tags={client.tags} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatDate(client.created_at)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <MobileCardList aria-label="Clientes">
        {rows.map((client) => (
          <ClientMobileCard key={client.id} client={client} members={members} />
        ))}
      </MobileCardList>
    </>
  )
}

/** Cartão do celular: contato, responsável e origem, com ligar, WhatsApp e abrir. */
function ClientMobileCard({ client, members }: { client: ClientListRow; members: MemberOption[] }) {
  const href = `${CLIENTS_PATH}/${client.id}`
  const phone = client.phone ?? client.whatsapp
  // Link só com número válido: um "tel:" ou "wa.me" quebrado não abre nada.
  const callable = phone && isValidPhoneBr(phone) ? phone : null
  const whatsapp = client.whatsapp && isValidPhoneBr(client.whatsapp) ? client.whatsapp : null
  const kindLabel = client.kind === "pf" ? "Pessoa física" : "Pessoa jurídica"

  return (
    <MobileCard
      title={
        <Link href={href} className="underline-offset-4 hover:underline">
          {client.name}
        </Link>
      }
      description={
        client.kind === "pj" && client.trade_name
          ? `${client.trade_name} · ${kindLabel}`
          : kindLabel
      }
      badges={<ClientTags tags={client.tags} />}
      facts={[
        {
          label: "Contato",
          value: (
            <span className="flex min-w-0 flex-col">
              {phone ? <span className="tabular-nums">{formatPhone(phone)}</span> : null}
              {client.email ? <span className="truncate">{client.email}</span> : null}
              {phone || client.email ? null : <span className="text-muted-foreground">—</span>}
            </span>
          ),
        },
        {
          label: "Responsável",
          value: client.assigned_to ? (
            getMemberName(members, client.assigned_to)
          ) : (
            <span className="text-muted-foreground">Sem responsável</span>
          ),
        },
        { label: "Origem", value: getClientSourceLabel(client.source) },
      ]}
      actions={
        <>
          {callable ? (
            <Button variant="outline" render={<a href={telHref(callable)} />} nativeButton={false}>
              <PhoneIcon data-icon="inline-start" />
              Ligar
            </Button>
          ) : null}
          {whatsapp ? (
            <Button
              variant="outline"
              render={<a href={whatsappHref(whatsapp)} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <MessageCircleIcon data-icon="inline-start" />
              WhatsApp
            </Button>
          ) : null}
          <Button variant="outline" render={<Link href={href} />} nativeButton={false}>
            <PanelRightOpenIcon data-icon="inline-start" />
            Abrir
          </Button>
        </>
      }
    />
  )
}
