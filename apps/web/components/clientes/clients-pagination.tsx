import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Pagination, PaginationContent, PaginationItem } from "@workspace/ui/components/pagination"

import { buildClientListHref, type ClientListFilters } from "@/lib/clientes/filters"

const numberFormat = new Intl.NumberFormat("pt-BR")

type ClientsPaginationProps = {
  filters: ClientListFilters
  total: number
  totalPages: number
}

export function ClientsPagination({ filters, total, totalPages }: ClientsPaginationProps) {
  const page = filters.pagina

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        {numberFormat.format(total)} {total === 1 ? "cliente" : "clientes"} · página{" "}
        {numberFormat.format(page)} de {numberFormat.format(totalPages)}
      </p>
      {totalPages > 1 ? (
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              {page > 1 ? (
                <Button
                  variant="ghost"
                  render={
                    <Link
                      href={buildClientListHref({
                        ...filters,
                        pagina: page - 1,
                      })}
                    />
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
                    <Link
                      href={buildClientListHref({
                        ...filters,
                        pagina: page + 1,
                      })}
                    />
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
