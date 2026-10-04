import { cn } from "@workspace/ui/lib/utils"

import type { LandingSocialProofStat, LandingTestimonial } from "@/lib/landing/types"

import { SectionHeading, lpDisplayFont, toneMuted, type LandingTone } from "./primitives"
import { Testimonials } from "./testimonials"

/** Números de prova social: valor em corpo condensado, rótulo abaixo, fio da marca acima. */
export function StatsRow({
  stats,
  tone = "surface",
  columns = 4,
  className,
}: {
  stats: LandingSocialProofStat[]
  tone?: LandingTone
  columns?: 2 | 4
  className?: string
}) {
  if (stats.length === 0) return null

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-7",
        columns === 4 && stats.length > 2 && "@3xl:grid-cols-4",
        className
      )}
    >
      {stats.map((stat, index) => (
        <div
          key={`${index}-${stat.stat_label}`}
          className={cn(
            "flex flex-col-reverse justify-end gap-1.5 border-t-2 pt-3",
            tone === "surface" ? "border-(--lp-brand)" : "border-current"
          )}
        >
          <dt className={cn("text-sm leading-snug text-pretty", toneMuted[tone])}>
            {stat.stat_label}
          </dt>
          <dd
            className={cn(
              lpDisplayFont,
              "text-[2.25rem] leading-none font-bold tracking-tight tabular-nums @3xl:text-[2.75rem]"
            )}
          >
            {stat.stat_value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function hasSocialProof(
  stats: LandingSocialProofStat[],
  testimonials: LandingTestimonial[]
) {
  return stats.length > 0 || testimonials.length > 0
}

/** Prova social completa (números + depoimentos). Some quando não há nenhum dos dois. */
export function SocialProof({
  headingId,
  title,
  description,
  stats,
  testimonials,
  layout = "wide",
}: {
  headingId: string
  title: string
  description?: string
  stats: LandingSocialProofStat[]
  testimonials: LandingTestimonial[]
  /** `column`: ao lado do formulário (números em 2 colunas, depoimentos empilhados). */
  layout?: "wide" | "column"
}) {
  if (!hasSocialProof(stats, testimonials)) return null

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading id={headingId} title={title} description={description} />
      <StatsRow stats={stats} columns={layout === "column" ? 2 : 4} />
      <Testimonials items={testimonials} layout={layout === "column" ? "column" : "grid"} />
    </div>
  )
}
