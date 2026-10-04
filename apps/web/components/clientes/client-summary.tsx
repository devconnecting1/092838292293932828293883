import { ShieldCheckIcon } from "lucide-react"

import type { Tables } from "@workspace/database/types"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { formatDate, formatDateTime } from "@/lib/format"
import { getLgpdLegalBasisLabel } from "@/lib/clientes/constants"
import { formatClientDocument, formatPostalCodeSafe } from "@/lib/clientes/format"

type DetailItem = { label: string; value: React.ReactNode }

function DetailList({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 wrap-break-word">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ClientSummary({ client }: { client: Tables<"clients"> }) {
  const isPf = client.kind === "pf"

  const registrationItems: DetailItem[] = isPf
    ? [
        { label: "CPF", value: formatClientDocument("pf", client.document) },
        { label: "RG", value: client.rg ?? "—" },
        {
          label: "Nascimento",
          value: client.birth_date ? formatDate(`${client.birth_date}T12:00:00-03:00`) : "—",
        },
        { label: "Cadastrado em", value: formatDate(client.created_at) },
      ]
    : [
        { label: "CNPJ", value: formatClientDocument("pj", client.document) },
        { label: "Nome fantasia", value: client.trade_name ?? "—" },
        { label: "Cadastrado em", value: formatDate(client.created_at) },
      ]

  const streetLine = [client.street, client.street_number].filter(Boolean).join(", ")
  const cityLine = [client.city, client.state].filter(Boolean).join(" / ")
  const hasAddress = Boolean(streetLine || client.neighborhood || cityLine || client.postal_code)

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Dados cadastrais</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList items={registrationItems} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endereço</CardTitle>
          {!hasAddress ? <CardDescription>Não informado.</CardDescription> : null}
        </CardHeader>
        {hasAddress ? (
          <CardContent>
            <DetailList
              items={[
                { label: "Logradouro", value: streetLine || "—" },
                { label: "Complemento", value: client.complement ?? "—" },
                { label: "Bairro", value: client.neighborhood ?? "—" },
                { label: "Cidade", value: cityLine || "—" },
                {
                  label: "CEP",
                  value: formatPostalCodeSafe(client.postal_code),
                },
              ]}
            />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proteção de dados</CardTitle>
          <CardDescription>
            Aberturas desta ficha e downloads de documentos ficam registrados.
          </CardDescription>
          <CardAction>
            <ShieldCheckIcon className="text-muted-foreground" aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              {
                label: "Base legal",
                value: getLgpdLegalBasisLabel(client.lgpd_legal_basis),
              },
              {
                label: "Consentimento",
                value: client.lgpd_consent_at ? formatDateTime(client.lgpd_consent_at) : "—",
              },
            ]}
          />
        </CardContent>
      </Card>

      {client.notes ? (
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm wrap-break-word whitespace-pre-wrap">{client.notes}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
