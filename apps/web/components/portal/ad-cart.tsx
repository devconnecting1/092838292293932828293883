"use client"

import * as React from "react"

const KEY = "va-anunciar"

function ler(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 200) : []
  } catch {
    return []
  }
}

function gravar(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Sem armazenamento (modo privado): a seleção vale só nesta página.
  }
  window.dispatchEvent(new Event(KEY))
}

/** Lista de imóveis marcados para anunciar nos portais (fica no aparelho). */
export function useAdCart() {
  const [ids, setIds] = React.useState<string[]>([])
  React.useEffect(() => {
    const sync = () => setIds(ler())
    sync()
    window.addEventListener(KEY, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(KEY, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])
  return {
    ids,
    alternar: (id: string) => gravar(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    remover: (id: string) => gravar(ids.filter((x) => x !== id)),
    limpar: () => gravar([]),
    definir: (novos: string[]) => gravar([...new Set(novos)].slice(0, 200)),
  }
}

export function AdCartToggle({ id, className }: { id: string; className?: string }) {
  const { ids, alternar } = useAdCart()
  const marcado = ids.includes(id)
  return (
    <button
      type="button"
      onClick={() => alternar(id)}
      aria-pressed={marcado}
      className={
        className ??
        `rounded-lg border px-3 py-2 text-xs font-bold ${marcado ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-300 text-slate-700"}`
      }
    >
      {marcado ? "Marcado para anunciar" : "Anunciar nos portais"}
    </button>
  )
}

export function AdCartBar() {
  const { ids } = useAdCart()
  if (!ids.length) return null
  return (
    <a
      href="/anunciar"
      className="fixed bottom-4 left-4 z-30 rounded-full bg-[var(--brand-deep)] px-5 py-3.5 text-sm font-bold text-white shadow-lg"
    >
      Anunciar {ids.length} imóve{ids.length === 1 ? "l" : "is"} nos portais
    </a>
  )
}
