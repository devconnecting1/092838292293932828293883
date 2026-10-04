import { PORTAL } from "@/lib/portal/config"

const tel = `tel:${PORTAL.whatsapp}`

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  )
}

/** Botão fixo "Fale conosco": liga direto para o 0800 da empresa. */
export function ContactButton() {
  return (
    <a
      href={tel}
      aria-label={`Fale conosco: ligar para ${PORTAL.whatsappLabel}, ligação gratuita`}
      className="group fixed right-4 bottom-4 z-30 flex items-center gap-3 rounded-full bg-white py-2 pr-5 pl-2 shadow-[0_10px_30px_-8px_rgba(15,23,42,0.45)] ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-[0_14px_36px_-8px_rgba(15,23,42,0.5)] print:hidden"
    >
      <span className="relative grid size-11 place-items-center rounded-full bg-[var(--brand)] text-white">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--brand)] opacity-25 motion-reduce:hidden" />
        <PhoneIcon className="relative size-5" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-extrabold text-slate-900 sm:text-[13px] sm:font-semibold sm:text-slate-500">
          Fale conosco
        </span>
        <span className="hidden text-base font-extrabold tracking-tight text-slate-900 sm:block">
          {PORTAL.whatsappLabel}
        </span>
      </span>
    </a>
  )
}

/** Telefone no topo do site (telas largas). Recebe os dados do servidor. */
export function HeaderPhone({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="mr-1 hidden items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-slate-900 hover:text-[var(--brand)] 2xl:inline-flex"
    >
      <PhoneIcon className="size-4 text-[var(--brand)]" />
      {label}
    </a>
  )
}
