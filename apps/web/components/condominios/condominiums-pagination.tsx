import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Pagination, PaginationContent, PaginationItem } from "@workspace/ui/components/pagination"

import { buildCondominiumsHref } from "@/lib/condominios/search"
import { formatNumber } from "@/lib/format"

type CondominiumsPaginationProps = {
  page: number
  pageSize: number
  total: number
  query: string
}

export function CondominiumsPagination({
  page,
  pageSize,
  total,
  query,
}: CondominiumsPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-sm text-muted-foreground tabular-nums">
        Mostrando {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
      </p>
      {totalPages > 1 ? (
        <Pagination aria-label="Paginação dos condomínios" className="mx-0 w-auto">
          <PaginationContent className="gap-2">
            <PaginationItem>
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link href={buildCondominiumsHref({ query, page: page - 1 })} rel="prev" />
                  }
                  nativeButton={false}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Anterior
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <ChevronLeftIcon data-icon="inline-start" />
                  Anterior
                </Button>
              )}
            </PaginationItem>
            <PaginationItem>
              <span className="text-sm tabular-nums" aria-current="page">
                Página {formatNumber(page)} de {formatNumber(totalPages)}
              </span>
            </PaginationItem>
            <PaginationItem>
              {page < totalPages ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link href={buildCondominiumsHref({ query, page: page + 1 })} rel="next" />
                  }
                  nativeButton={false}
                >
                  Próxima
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
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
