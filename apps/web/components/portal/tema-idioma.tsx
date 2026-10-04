"use client"

import * as React from "react"

const CHAVE = "va-tema"

/** Script que aplica o tema salvo antes da página aparecer (evita piscar). */
export const SCRIPT_TEMA = `try{if(localStorage.getItem("${CHAVE}")==="escuro")document.documentElement.classList.add("tema-escuro")}catch(e){}`

const IDIOMAS: [string, string][] = [
  ["en", "English"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["zh-CN", "中文"],
  ["ja", "日本語"],
  ["ar", "العربية"],
  ["ru", "Русский"],
]

export function BotaoTema() {
  const [escuro, setEscuro] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(
      () => setEscuro(document.documentElement.classList.contains("tema-escuro")),
      0
    )
    return () => clearTimeout(t)
  }, [])
  function trocar() {
    const novo = !escuro
    setEscuro(novo)
    document.documentElement.classList.toggle("tema-escuro", novo)
    try {
      localStorage.setItem(CHAVE, novo ? "escuro" : "claro")
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }
  return (
    <button
      type="button"
      onClick={trocar}
      aria-label={escuro ? "Usar fundo branco" : "Usar fundo escuro"}
      title={escuro ? "Fundo branco" : "Fundo escuro"}
      className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-300 text-lg"
    >
      {escuro ? "☀" : "☾"}
    </button>
  )
}

/** Tradução do site pelo Google Tradutor (abre a mesma página no idioma escolhido). */
export function SeletorIdioma() {
  function ir(lang: string) {
    if (!lang) return
    const host = window.location.hostname.replace(/-/g, "--").replace(/\./g, "-")
    const url = `https://${host}.translate.goog${window.location.pathname}?_x_tr_sl=pt&_x_tr_tl=${lang}&_x_tr_hl=${lang}`
    window.location.href = url
  }
  return (
    <select
      aria-label="Idioma"
      defaultValue=""
      onChange={(e) => ir(e.target.value)}
      className="h-10 w-[88px] rounded-lg border border-slate-300 bg-white px-1.5 text-sm font-semibold"
    >
      <option value="">🌐 PT</option>
      {IDIOMAS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

/** Cores do tema escuro: troca as cores claras mais usadas no portal. */
export const CSS_TEMA_ESCURO = `
html.tema-escuro { color-scheme: dark; }
html.tema-escuro .bg-white, html.tema-escuro body { background-color: #0b1220 !important; }
html.tema-escuro .bg-white\\/95 { background-color: rgba(11,18,32,.95) !important; }
html.tema-escuro .bg-slate-50, html.tema-escuro .bg-slate-100 { background-color: #111a2e !important; }
html.tema-escuro .bg-\\[var\\(--brand-soft\\)\\] { background-color: #12204a !important; }
html.tema-escuro .text-slate-900, html.tema-escuro .text-slate-950, html.tema-escuro .text-slate-800 { color: #e5e7eb !important; }
html.tema-escuro .text-slate-700 { color: #cbd5e1 !important; }
html.tema-escuro .text-slate-600, html.tema-escuro .text-slate-500 { color: #94a3b8 !important; }
html.tema-escuro .border-slate-100, html.tema-escuro .border-slate-200, html.tema-escuro .border-slate-300 { border-color: #24324f !important; }
html.tema-escuro input, html.tema-escuro select, html.tema-escuro textarea { background-color: #0f172a !important; color: #e5e7eb !important; border-color: #24324f !important; }
html.tema-escuro .text-\\[var\\(--brand\\)\\] { color: #8fb0ff !important; }
html.tema-escuro .text-\\[var\\(--brand-deep\\)\\] { color: #c7d6ff !important; }
html.tema-escuro .bg-emerald-50 { background-color: #0d2a20 !important; }
html.tema-escuro .bg-amber-50 { background-color: #2a220d !important; }
html.tema-escuro .bg-red-50 { background-color: #2a1212 !important; }
`
