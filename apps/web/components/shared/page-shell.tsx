import * as React from "react"
import { cn } from "cn"

/**
 * Casca de largura por tipo de página (plano de design system, seção 5).
 *
 * Nenhuma página usa `max-w-*` solto: a largura sai da variante, e o espaço que
 * sobra em telas largas vai para o trilho direito de contexto (`rail`).
 *
 * - `fluid`: listas, kanban, agenda e índices; 100% da largura útil.
 * - `record`: registro com painel de campos (`aside`) e conteúdo fluido; o
 *   trilho só vira coluna própria a partir de 1920 px (antes, desce para o fim
 *   da coluna de campos).
 * - `settings`: conteúdo de configurações; leitura até 960 px (`width="reading"`)
 *   ou fluido (`width="wide"`), com trilho a partir de 1536 px.
 * - `form`: formulários longos; o formulário para de crescer em 1280 px e o
 *   trilho aparece a partir de 1920 px.
 *
 * Grades internas devem usar container queries (`@container/page` na raiz e
 * `@container/main` na coluna principal), porque a sidebar pode estar aberta ou
 * recolhida.
 */

type PageShellVariant = "fluid" | "record" | "settings" | "form"

type PageShellProps = Omit<React.ComponentProps<"div">, "children"> & {
  variant?: PageShellVariant
  /** Cabeçalho da página (título, descrição e ações). */
  header?: React.ReactNode
  /** Dica dispensável logo abaixo do cabeçalho. */
  tip?: React.ReactNode
  /** Sub-navegação vertical (configurações). Vira faixa no topo abaixo de 1024 px. */
  nav?: React.ReactNode
  /** Rótulo acessível da sub-navegação. */
  navLabel?: string
  /** `record`: painel de campos; `form`: índice de seções. */
  aside?: React.ReactNode
  /** Trilho direito de contexto. Abaixo do breakpoint da variante, desce para o fim. */
  rail?: React.ReactNode
  /** Barra de ações fixa no rodapé da coluna principal. */
  footer?: React.ReactNode
  /** `settings`: largura de leitura (960 px, padrão) ou fluida. */
  width?: "reading" | "wide"
  /** `fluid`: sem padding lateral (kanban, editores em tela cheia). */
  bleed?: boolean
  children: React.ReactNode
}

const ROOT_CLASS = "@container/page flex flex-1 flex-col gap-6 p-4 lg:p-6"

function bodyClass(
  variant: PageShellVariant,
  { hasAside, hasRail, width }: { hasAside: boolean; hasRail: boolean; width: "reading" | "wide" }
) {
  switch (variant) {
    case "record":
      if (hasAside) {
        // Linhas auto + 1fr: o conteúdo ocupa as duas e a sobra de altura vai para a
        // segunda, assim o trilho encosta logo abaixo dos campos (1280–1919).
        return cn(
          "grid gap-6 min-[80rem]:grid-rows-[auto_1fr]",
          "min-[80rem]:grid-cols-[22.5rem_minmax(0,1fr)] 2xl:grid-cols-[26.25rem_minmax(0,1fr)]",
          hasRail && "min-[120rem]:grid-cols-[26.25rem_minmax(0,1fr)_minmax(18rem,24rem)]"
        )
      }

      return cn(
        "grid gap-6",
        hasRail && "min-[120rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]"
      )

    case "settings":
      if (width === "wide") {
        return cn(
          "grid gap-6",
          hasRail &&
            "2xl:grid-cols-[minmax(0,1fr)_18rem] min-[120rem]:grid-cols-[minmax(0,1fr)_24rem]"
        )
      }

      return cn(
        "grid gap-6",
        hasRail
          ? "2xl:grid-cols-[minmax(0,60rem)_18rem] min-[120rem]:grid-cols-[minmax(0,60rem)_24rem]"
          : "2xl:grid-cols-[minmax(0,60rem)]"
      )

    case "form":
      return cn(
        "grid gap-6",
        hasAside
          ? hasRail
            ? "lg:grid-cols-[12.5rem_minmax(0,80rem)] min-[120rem]:grid-cols-[12.5rem_minmax(0,80rem)_18rem]"
            : "lg:grid-cols-[12.5rem_minmax(0,80rem)]"
          : hasRail
            ? "grid-cols-[minmax(0,80rem)] min-[120rem]:grid-cols-[minmax(0,80rem)_18rem]"
            : "grid-cols-[minmax(0,80rem)]"
      )

    default:
      return cn("grid gap-6", hasRail && "@min-[76rem]/page:grid-cols-[minmax(0,1fr)_20rem]")
  }
}

function asideClass(variant: PageShellVariant) {
  if (variant === "record") {
    return "flex min-w-0 flex-col gap-6 min-[80rem]:col-start-1 min-[80rem]:row-start-1"
  }

  // form: índice de seções fixo ao rolar; some abaixo de 1024 px.
  return "hidden min-w-0 flex-col gap-2 lg:sticky lg:top-6 lg:row-start-1 lg:flex lg:self-start"
}

function mainClass(variant: PageShellVariant, hasAside: boolean) {
  return cn(
    "@container/main flex min-w-0 flex-col gap-6",
    variant === "record" &&
      hasAside &&
      "min-[80rem]:col-start-2 min-[80rem]:row-span-2 min-[80rem]:row-start-1",
    variant === "form" && hasAside && "lg:col-start-2 lg:row-start-1"
  )
}

function railClass(variant: PageShellVariant, hasAside: boolean) {
  if (variant === "record" && hasAside) {
    return cn(
      "flex min-w-0 flex-col gap-4 self-start",
      "min-[80rem]:col-start-1 min-[80rem]:row-start-2",
      "min-[120rem]:col-start-3 min-[120rem]:row-span-2 min-[120rem]:row-start-1"
    )
  }

  if (variant === "form") {
    // Abaixo de 1920 px o trilho desce para baixo do formulário (na coluna dele).
    return cn(
      "flex min-w-0 flex-col gap-4 self-start",
      hasAside
        ? "lg:col-start-2 min-[120rem]:col-start-3 min-[120rem]:row-start-1"
        : "min-[120rem]:col-start-2 min-[120rem]:row-start-1"
    )
  }

  return "flex min-w-0 flex-col gap-4 self-start"
}

/**
 * Moldura com sub-navegação vertical à esquerda (configurações). Abaixo de
 * 1024 px, a navegação vira uma faixa no topo, acima do conteúdo.
 */
export function PageShellNavFrame({
  nav,
  label = "Configurações",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { nav: React.ReactNode; label?: string }) {
  return (
    <div
      data-slot="page-shell-frame"
      className={cn(
        "flex flex-1 flex-col lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start",
        className
      )}
      {...props}
    >
      <nav
        aria-label={label}
        data-slot="page-shell-nav"
        className="min-w-0 px-4 pt-4 lg:sticky lg:top-0 lg:ps-6 lg:pe-0 lg:pt-6"
      >
        {nav}
      </nav>
      <div data-slot="page-shell-frame-content" className="flex min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}

export function PageShell({
  variant = "fluid",
  header,
  tip,
  nav,
  navLabel,
  aside,
  rail,
  footer,
  width = "reading",
  bleed = false,
  className,
  children,
  ...props
}: PageShellProps) {
  const hasAside = aside !== undefined && aside !== null && aside !== false
  const hasRail = rail !== undefined && rail !== null && rail !== false
  const hasFooter = footer !== undefined && footer !== null && footer !== false

  // fluid simples: mantém os filhos diretos no flex da raiz (mesma forma das listas atuais).
  const simpleFluid = variant === "fluid" && !hasRail && !hasFooter

  const shell = (
    <div
      data-slot="page-shell"
      data-variant={variant}
      data-width={variant === "settings" ? width : undefined}
      className={cn(ROOT_CLASS, bleed && variant === "fluid" && "px-0 lg:px-0", className)}
      {...props}
    >
      {header}
      {tip}
      {simpleFluid ? (
        children
      ) : (
        <div
          data-slot="page-shell-body"
          className={bodyClass(variant, { hasAside, hasRail, width })}
        >
          {hasAside ? (
            <aside
              data-slot="page-shell-aside"
              aria-label={variant === "form" ? "Seções do formulário" : "Campos do registro"}
              className={asideClass(variant)}
            >
              {aside}
            </aside>
          ) : null}
          <div data-slot="page-shell-main" className={mainClass(variant, hasAside)}>
            {children}
            {hasFooter ? (
              <div data-slot="page-shell-footer" className="sticky bottom-0 z-10">
                {footer}
              </div>
            ) : null}
          </div>
          {hasRail ? (
            <aside
              data-slot="page-shell-rail"
              aria-label="Contexto"
              className={railClass(variant, hasAside)}
            >
              {rail}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  )

  if (nav !== undefined && nav !== null && nav !== false) {
    return (
      <PageShellNavFrame nav={nav} label={navLabel}>
        {shell}
      </PageShellNavFrame>
    )
  }

  return shell
}
