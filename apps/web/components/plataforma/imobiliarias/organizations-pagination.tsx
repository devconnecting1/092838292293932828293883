import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import {
  buildOrganizationListHref,
  type OrganizationListFilters,
} from "@workspace/core/platform/accounts"
import { Button } from "@workspace/ui/components/button"
import { Pagination, PaginationContent, PaginationItem } from "@workspace/ui/components/pagination"

import { formatNumber } from "@/lib/format"

export function OrganizationsPagination({
  filters,
  total,
  totalPages,
}: {
  filters: OrganizationListFilters
  total: number
  totalPages: number
}) {
  const page = filters.pagina

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        {formatNumber(total)} {total === 1 ? "imobiliária" : "imobiliárias"} · página{" "}
        {formatNumber(page)} de {formatNumber(totalPages)}
      </p>
      {totalPages > 1 ? (
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              {page > 1 ? (
                <Button
                  variant="ghost"
                  render={
                    <Link href={buildOrganizationListHref({ ...filters, pagina: page - 1 })} />
                  }
                  nativeButton={false}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Anterior
                </Button>
              ) : (
                <Button variant="ghost" disabled>
                  <ChevronLeftIcon data-icon="inline-start" />
                  Anterior
                </Button>
              )}
            </PaginationItem>
            <PaginationItem>
              {page < totalPages ? (
                <Button
                  variant="ghost"
                  render={
                    <Link href={buildOrganizationListHref({ ...filters, pagina: page + 1 })} />
                  }
                  nativeButton={false}
                >
                  Próxima
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              ) : (
                <Button variant="ghost" disabled>
                  Próxima
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  )
}
