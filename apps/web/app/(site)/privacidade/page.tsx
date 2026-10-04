import type { Metadata } from "next"

import { PageHero } from "@/components/portal/content"
import { PRIVACY_HTML } from "@/lib/portal/privacy-html"

export const metadata: Metadata = {
  title: "Política de privacidade",
  description:
    "Como tratamos os seus dados pessoais, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).",
}

export default function PrivacidadePage() {
  return (
    <>
      <PageHero
        kicker="LGPD"
        title="Política de Privacidade e Proteção de Dados Pessoais"
        text="Nós não vendemos, não alugamos e não cedemos os seus dados pessoais a ninguém. Usamos apenas o necessário e compartilhamos somente nas situações descritas abaixo."
      />
      <article
        className="mx-auto max-w-[860px] px-4 py-12 leading-relaxed text-slate-700 sm:px-6 [&_.fonte]:text-sm [&_.fonte]:text-slate-500 [&_a]:text-[var(--brand)] [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-extrabold [&_h2]:text-slate-900 [&_mark]:bg-amber-100 [&_p]:my-3 [&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:border-slate-200 [&_td]:p-3 [&_td]:align-top [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-3 [&_th]:text-left"
        dangerouslySetInnerHTML={{ __html: PRIVACY_HTML }}
      />
    </>
  )
}
