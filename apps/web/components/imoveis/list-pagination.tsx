import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@workspace/ui/components/pagination"

function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b)
  const result: (number | "gap")[] = []

  for (const [index, value] of sorted.entries()) {
    const previous = sorted[index - 1]
    if (previous !== undefined && value - previous > 1) result.push("gap")
    result.push(value)
  }

  return result
}

/** Paginação por links (searchParam `pagina`), preservando os filtros. */
export function ListPagination({
  basePath,
  searchParams,
  page,
  pageCount,
  pageParam = "pagina",
}: {
  basePath: string
  searchParams: URLSearchParams
  page: number
  pageCount: number
  pageParam?: string
}) {
  if (pageCount <= 1) return null

  function href(target: number) {
    const params = new URLSearchParams(searchParams)
    if (target > 1) params.set(pageParam, String(target))
    else params.delete(pageParam)
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <Pagination aria-label="Paginação">
      <PaginationContent className="flex-wrap justify-center">
        <PaginationItem>
          {page > 1 ? (
            <Button variant="ghost" render={<Link href={href(page - 1)} />} nativeButton={false}>
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
        {pageWindow(page, pageCount).map((value, index) =>
          value === "gap" ? (
            <PaginationItem key={`gap-${index}`} className="hidden sm:block">
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={value} className="hidden sm:block">
              <Button
                variant={value === page ? "outline" : "ghost"}
                size="icon"
                aria-current={value === page ? "page" : undefined}
                render={<Link href={href(value)} />}
                nativeButton={false}
              >
                {value}
              </Button>
            </PaginationItem>
          )
        )}
        <PaginationItem className="px-2 text-sm text-muted-foreground sm:hidden">
          {page} de {pageCount}
        </PaginationItem>
        <PaginationItem>
          {page < pageCount ? (
            <Button variant="ghost" render={<Link href={href(page + 1)} />} nativeButton={false}>
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
  )
}
