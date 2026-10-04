"use client"

import { usePathname, useRouter } from "next/navigation"

/** Seta discreta para voltar à página anterior (some na home). */
export function BackButton() {
  const pathname = usePathname()
  const router = useRouter()
  if (pathname === "/") return null
  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-4 sm:px-6 print:hidden">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
        className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pr-4 pl-1.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
        aria-label="Voltar à página anterior"
      >
        <span className="grid size-7 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)] transition group-hover:-translate-x-0.5">
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </span>
        Voltar
      </button>
    </div>
  )
}
