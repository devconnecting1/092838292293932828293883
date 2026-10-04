import { DownloadIcon, ExternalLinkIcon, ReceiptTextIcon } from "lucide-react"

import { formatBRL } from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import type { RecentInvoice } from "@/components/billing/billing-data"
import { formatDate } from "@/lib/format"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const INVOICE_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  paid: { label: "Paga", variant: "secondary" },
  open: { label: "Em aberto", variant: "outline" },
  draft: { label: "Rascunho", variant: "outline" },
  uncollectible: { label: "Não paga", variant: "destructive" },
  void: { label: "Cancelada", variant: "outline" },
}

function invoiceStatus(status: string) {
  return INVOICE_STATUS[status] ?? { label: status, variant: "outline" as const }
}

function invoiceTitle(invoice: RecentInvoice) {
  return invoice.number ? `Fatura ${invoice.number}` : "Fatura sem número"
}

function InvoiceLinks({ invoice }: { invoice: RecentInvoice }) {
  const title = invoiceTitle(invoice)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {invoice.hostedUrl ? (
        <Button
          variant="outline"
          size="sm"
          render={<a href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Ver fatura
          <span className="sr-only"> {title} (abre em nova aba)</span>
        </Button>
      ) : null}
      {invoice.pdfUrl ? (
        <Button
          variant="ghost"
          size="sm"
          render={<a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          <DownloadIcon data-icon="inline-start" />
          PDF
          <span className="sr-only"> da {title} (abre em nova aba)</span>
        </Button>
      ) : null}
    </div>
  )
}

/** Últimas faturas lidas da Stripe: tabela no desktop, cards no celular. */
export function InvoicesList({
  invoices,
  stripeConfigured,
}: {
  invoices: RecentInvoice[]
  stripeConfigured: boolean
}) {
  if (invoices.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptTextIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma fatura ainda</EmptyTitle>
          <EmptyDescription>
            {stripeConfigured
              ? "As faturas aparecem aqui depois do primeiro pagamento."
              : "As faturas aparecem aqui quando os pagamentos estiverem configurados."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">Faturas recentes da assinatura</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Fatura</TableHead>
              <TableHead scope="col">Data</TableHead>
              <TableHead scope="col" className="text-end">
                Valor
              </TableHead>
              <TableHead scope="col">Situação</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Links</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const status = invoiceStatus(invoice.status)

              return (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.number ?? "—"}</TableCell>
                  <TableCell>{formatDate(invoice.createdAt)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatBRL(invoice.amountCents)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <InvoiceLinks invoice={invoice} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <ItemGroup className="md:hidden">
        {invoices.map((invoice) => {
          const status = invoiceStatus(invoice.status)

          return (
            <Item key={invoice.id} variant="outline" role="listitem">
              <ItemContent>
                <ItemTitle>{invoiceTitle(invoice)}</ItemTitle>
                <ItemDescription>
                  {formatDate(invoice.createdAt)} · {formatBRL(invoice.amountCents)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={status.variant}>{status.label}</Badge>
              </ItemActions>
              {invoice.hostedUrl || invoice.pdfUrl ? (
                <ItemFooter>
                  <InvoiceLinks invoice={invoice} />
                </ItemFooter>
              ) : null}
            </Item>
          )
        })}
      </ItemGroup>
    </>
  )
}
