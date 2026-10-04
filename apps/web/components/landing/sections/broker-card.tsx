import { MessageCircleIcon, PhoneIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

import type { LandingBrokerView, LandingOrganizationView } from "@/lib/landing/view-model"

import { lpButtonClass, lpFocus } from "./primitives"

/** Corretor responsável com CRECI (bloco compacto, para páginas de imóvel e lançamento). */
export function BrokerCard({
  broker,
  organization,
  whatsappHref,
  headingId,
  className,
}: {
  broker: LandingBrokerView
  organization: LandingOrganizationView
  whatsappHref: string | null
  headingId: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 rounded-(--lp-radius) border border-(--lp-line) bg-(--lp-surface) p-5 text-(--lp-ink) @xl:flex-row @xl:items-center",
        className
      )}
    >
      <Avatar className="size-16">
        {broker.avatarUrl ? (
          <AvatarImage src={broker.avatarUrl} alt={`Foto de ${broker.name}`} />
        ) : null}
        <AvatarFallback>{broker.initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-(--lp-ink-muted)">Atendimento com</p>
        <h2 id={headingId} className="text-lg leading-snug font-semibold">
          {broker.name}
        </h2>
        <p className="text-sm text-(--lp-ink-muted)">
          {[broker.creciLabel, organization.name].filter(Boolean).join(", ")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={lpButtonClass({ tone: "primary" })}
          >
            <MessageCircleIcon aria-hidden="true" />
            WhatsApp
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        ) : null}
        {broker.phoneHref && broker.phoneDisplay ? (
          <a href={broker.phoneHref} className={cn(lpButtonClass({ tone: "outline" }), lpFocus)}>
            <PhoneIcon aria-hidden="true" />
            {broker.phoneDisplay}
          </a>
        ) : null}
      </div>
    </div>
  )
}
