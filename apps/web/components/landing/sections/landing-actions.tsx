import { MessageCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { lpButtonClass, type LandingMode } from "./primitives"

/** Verde do WhatsApp com texto escuro (7.9:1); branco sobre ele não passa no contraste. */
const whatsappClass =
  "bg-[#25D366] text-[#07210F] hover:bg-[#1EBE5B] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)"

/**
 * Ações persistentes:
 * - mobile (< @3xl): barra fixa no rodapé com o CTA que rola até o formulário
 *   e, se houver número, o atalho do WhatsApp;
 * - desktop: botão flutuante do WhatsApp.
 * Na pré-visualização usa `sticky` em vez de `fixed`, para ficar dentro do
 * painel do editor (o wrapper precisa ser o conteúdo de um container rolável).
 */
export function LandingActions({
  formHref,
  ctaLabel,
  whatsappHref,
  mode,
}: {
  formHref: string
  ctaLabel: string
  whatsappHref: string | null
  mode: LandingMode
}) {
  const position = mode === "public" ? "fixed" : "sticky"

  return (
    <>
      <div
        className={cn(
          position,
          "inset-x-0 bottom-0 z-40 border-t border-(--lp-line) bg-(--lp-surface) px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-(--lp-ink) @3xl:hidden"
        )}
      >
        <div className="flex gap-2">
          <a href={formHref} className={lpButtonClass({ className: "flex-1" })}>
            {ctaLabel}
          </a>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Conversar no WhatsApp (abre em nova aba)"
              className={cn(
                "inline-flex min-h-11 min-w-11 items-center justify-center rounded-(--lp-radius) motion-safe:transition-colors",
                whatsappClass
              )}
            >
              <MessageCircleIcon aria-hidden="true" className="size-5" />
            </a>
          ) : null}
        </div>
      </div>

      {whatsappHref ? (
        <div
          className={cn(
            position,
            "bottom-6 z-40 hidden @3xl:flex",
            mode === "public" ? "right-6" : "ms-auto me-6 w-fit"
          )}
        >
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex min-h-13 items-center gap-2 rounded-full px-5 font-semibold shadow-lg motion-safe:transition-colors",
              whatsappClass
            )}
          >
            <MessageCircleIcon aria-hidden="true" className="size-5" />
            WhatsApp
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        </div>
      ) : null}
    </>
  )
}
