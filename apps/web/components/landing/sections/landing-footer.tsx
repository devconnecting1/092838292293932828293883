import { MailIcon, MessageCircleIcon, PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { LandingViewModel } from "@/lib/landing/view-model"

import { BrandMark } from "./landing-header"
import { lpFocusInverse } from "./primitives"

const linkClass = cn(
  "inline-flex items-center gap-2 rounded-sm underline-offset-4 hover:underline",
  lpFocusInverse
)

export const LGPD_NOTICE =
  "Os dados enviados nesta página são usados somente para retornar o seu contato, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Você pode pedir a exclusão a qualquer momento pelos contatos acima."

/**
 * Rodapé com identificação legal (CRECI da imobiliária e do corretor),
 * contatos e aviso LGPD. Espaço extra embaixo no mobile para a barra fixa.
 */
export function LandingFooter({
  vm,
  disclaimer,
}: {
  vm: LandingViewModel
  /** Aviso comercial (imagens ilustrativas, valores sujeitos a alteração…). */
  disclaimer?: string
}) {
  const { organization, broker } = vm

  return (
    <footer className="bg-(--lp-secondary) px-4 pt-12 pb-28 text-(--lp-on-secondary) @3xl:px-8 @3xl:pb-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-8 @3xl:flex-row @3xl:items-start @3xl:justify-between">
          <div className="flex flex-col gap-3">
            <BrandMark organization={organization} inverse />
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-(--lp-on-secondary-muted)">
              {organization.creciLabel ? <li>{organization.creciLabel}</li> : null}
              {organization.place ? <li>{organization.place}</li> : null}
            </ul>
            {broker ? (
              <p className="text-sm text-(--lp-on-secondary-muted)">
                Corretor responsável: {broker.name}
                {broker.creciLabel ? `, ${broker.creciLabel}` : ""}
              </p>
            ) : null}
          </div>

          <address className="flex flex-col gap-2.5 text-sm not-italic">
            {vm.whatsappHref ? (
              <a
                href={vm.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                <MessageCircleIcon aria-hidden="true" className="size-4" />
                WhatsApp
                <span className="sr-only">(abre em nova aba)</span>
              </a>
            ) : null}
            {organization.phoneHref && organization.phoneDisplay ? (
              <a href={organization.phoneHref} className={linkClass}>
                <PhoneIcon aria-hidden="true" className="size-4" />
                {organization.phoneDisplay}
              </a>
            ) : null}
            {organization.email ? (
              <a href={`mailto:${organization.email}`} className={linkClass}>
                <MailIcon aria-hidden="true" className="size-4" />
                {organization.email}
              </a>
            ) : null}
          </address>
        </div>

        <div className="flex flex-col gap-2 border-t border-(--lp-secondary-border) pt-6 text-xs leading-relaxed text-(--lp-on-secondary-muted)">
          {disclaimer ? <p>{disclaimer}</p> : null}
          <p>{LGPD_NOTICE}</p>
          <p>© {organization.name}</p>
        </div>
      </div>
    </footer>
  )
}
