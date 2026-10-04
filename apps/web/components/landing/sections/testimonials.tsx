import { cn } from "@workspace/ui/lib/utils"

import { initialsOf } from "@/lib/landing/format"
import type { LandingTestimonial } from "@/lib/landing/types"

/**
 * Depoimentos como citações (figure/blockquote/figcaption), fio lateral na cor
 * da marca. `column` empilha (para colunas estreitas ao lado do formulário).
 */
export function Testimonials({
  items,
  layout = "grid",
  className,
}: {
  items: LandingTestimonial[]
  layout?: "grid" | "column"
  className?: string
}) {
  if (items.length === 0) return null

  return (
    <ul
      className={cn(
        layout === "column"
          ? "flex flex-col gap-8"
          : cn("grid gap-x-8 gap-y-10 @3xl:grid-cols-2", items.length >= 3 && "@5xl:grid-cols-3"),
        className
      )}
    >
      {items.map((item, index) => (
        <li key={`${index}-${item.name}`} className="flex">
          <figure className="flex w-full flex-col gap-5 border-s-2 border-(--lp-brand) ps-5">
            <blockquote className="text-[1.0625rem] leading-relaxed text-pretty whitespace-pre-line">
              <p>{item.text}</p>
            </blockquote>
            <figcaption className="mt-auto flex items-center gap-3 text-sm font-semibold">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--lp-primary-soft) text-xs font-bold text-(--lp-on-primary-soft)"
              >
                {initialsOf(item.name)}
              </span>
              {item.name}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  )
}
