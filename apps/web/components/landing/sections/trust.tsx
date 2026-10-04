import { BadgeCheckIcon, LandmarkIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { LandingViewModel } from "@/lib/landing/view-model"

import { toneMuted, type LandingTone } from "./primitives"

/**
 * Selo CRECI (registro obrigatório para intermediar imóveis). Na página do
 * corretor usa o CRECI dele; nas demais, o da imobiliária e, na falta, o do
 * corretor responsável.
 */
export function CreciSeal({
  vm,
  tone = "surface",
  className,
}: {
  vm: LandingViewModel
  tone?: LandingTone
  className?: string
}) {
  const preferBroker = vm.key === "portfolio_broker"
  const broker = vm.broker?.creciLabel
    ? { holder: vm.broker.name, label: vm.broker.creciLabel }
    : null
  const agency = vm.organization.creciLabel
    ? { holder: vm.organization.name, label: vm.organization.creciLabel }
    : null
  const seal = preferBroker ? (broker ?? agency) : (agency ?? broker)

  if (!seal) return null

  return (
    <p className={cn("flex items-start gap-2.5 text-sm leading-snug", className)}>
      <BadgeCheckIcon
        aria-hidden="true"
        className={cn("mt-px size-5 shrink-0", tone === "surface" && "text-(--lp-primary-text)")}
      />
      <span className="flex flex-col">
        <span className="font-semibold">{seal.label}</span>
        <span className={toneMuted[tone]}>
          {preferBroker ? "Corretor registrado" : "Registro profissional"}: {seal.holder}
        </span>
      </span>
    </p>
  )
}

/** Escassez em lançamentos: "Restam 12 unidades" (fundo de destaque, ≥ 4.5:1). */
export function UnitsLeft({ label, className }: { label: string | null; className?: string }) {
  if (!label) return null
  return (
    <p
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-full bg-(--lp-accent) px-3.5 py-1.5 text-sm font-semibold text-(--lp-on-accent)",
        className
      )}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {label}
    </p>
  )
}

/** Condição de financiamento em uma linha. */
export function FinancingNote({
  text,
  tone = "surface",
  className,
}: {
  text: string | null
  tone?: LandingTone
  className?: string
}) {
  if (!text) return null
  return (
    <p className={cn("flex items-start gap-2 text-sm leading-snug", className)}>
      <LandmarkIcon
        aria-hidden="true"
        className={cn("mt-px size-4 shrink-0", tone === "surface" && "text-(--lp-primary-text)")}
      />
      <span className="text-pretty">{text}</span>
    </p>
  )
}
