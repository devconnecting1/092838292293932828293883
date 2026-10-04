import { PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { LandingOrganizationView, LandingViewModel } from "@/lib/landing/view-model"

import { LandingImage, lpButtonClass, lpFocus } from "./primitives"

/**
 * Identidade da imobiliária: logo (numa placa clara quando está sobre foto,
 * para logos escuros continuarem visíveis) ou iniciais + nome.
 */
export function BrandMark({
  organization,
  inverse = false,
  className,
}: {
  organization: LandingOrganizationView
  inverse?: boolean
  className?: string
}) {
  if (organization.logoUrl) {
    return (
      <span
        className={cn(
          "inline-flex items-center",
          inverse && "rounded-(--lp-radius) bg-(--lp-surface) px-3 py-2",
          className
        )}
      >
        <LandingImage
          src={organization.logoUrl}
          alt={organization.name}
          width={200}
          height={60}
          eager
          fit="contain"
          className="h-8 w-auto max-w-40 @3xl:h-10"
        />
      </span>
    )
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-(--lp-radius) text-sm font-bold",
          inverse ? "bg-(--lp-surface) text-(--lp-ink)" : "bg-(--lp-primary) text-(--lp-on-primary)"
        )}
      >
        {organization.initials}
      </span>
      <span className="truncate font-semibold">{organization.name}</span>
    </span>
  )
}

/**
 * Cabeçalho enxuto (landing page não tem menu: o único caminho é o formulário).
 * - overlay: sobre o hero com foto; só elementos com fundo próprio (logo em
 *   placa, botão claro), porque o véu pode ser mais leve à direita.
 * - solid: faixa clara com linha inferior e telefone no desktop.
 */
export function LandingHeader({
  vm,
  formHref,
  variant = "solid",
  showCta = true,
}: {
  vm: LandingViewModel
  formHref: string
  variant?: "overlay" | "solid"
  showCta?: boolean
}) {
  const overlay = variant === "overlay"
  const { organization } = vm

  return (
    <header
      className={cn(
        "z-10 w-full px-4 @3xl:px-8",
        overlay
          ? "absolute inset-x-0 top-0 text-(--lp-on-scrim)"
          : "relative border-b border-(--lp-line) bg-(--lp-surface) text-(--lp-ink)"
      )}
    >
      <div className="mx-auto flex min-h-18 max-w-6xl items-center justify-between gap-4 py-3">
        <BrandMark organization={organization} inverse={overlay} />
        <div className="flex items-center gap-5">
          {!overlay && organization.phoneHref && organization.phoneDisplay ? (
            <a
              href={organization.phoneHref}
              className={cn(
                "hidden items-center gap-2 rounded-sm text-sm font-medium underline-offset-4 hover:underline @3xl:inline-flex",
                lpFocus
              )}
            >
              <PhoneIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
              {organization.phoneDisplay}
            </a>
          ) : null}
          {showCta ? (
            <a
              href={formHref}
              className={lpButtonClass({
                tone: overlay ? "light" : "primary",
                className: "hidden @xl:inline-flex",
              })}
            >
              {vm.copy.ctaLabel}
            </a>
          ) : null}
        </div>
      </div>
    </header>
  )
}
