"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/** Lê e grava filtros na query string (?responsavel=…), sem rolar a página. */
export function useFilterParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = React.useTransition()

  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())

      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }

      const query = params.toString()

      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        })
      })
    },
    [pathname, router, searchParams]
  )

  return { searchParams, setParams, isPending }
}
