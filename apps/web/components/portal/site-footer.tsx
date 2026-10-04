import Link from "next/link"

import { PORTAL, whatsappHref } from "@/lib/portal/config"

export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="bg-slate-900 text-slate-300 print:hidden">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div className="flex flex-col gap-3 md:col-span-1">
          <span className="text-lg font-extrabold text-white">{PORTAL.name}</span>
          <span className="text-sm leading-relaxed">
            Leilões de imóveis em todo o Brasil, com assessoria do edital à chave.
          </span>
          <span className="text-sm">{PORTAL.creci}</span>
          <a href={whatsappHref()} className="text-sm font-semibold text-white">
            {PORTAL.whatsappLabel}
          </a>
        </div>
        <FooterCol
          title="Leilões"
          links={[
            ["Todos os leilões", "/leiloes"],
            ["Como funciona", "/como-funciona"],
            ["Avalie seu crédito", "/credito"],
          ]}
        />
        <FooterCol
          title="Serviços"
          links={[
            ["Notificação extrajudicial", "/servicos/notificacao-extrajudicial"],
            ["Imissão na posse amigável", "/servicos/imissao-na-posse-amigavel"],
            ["Todos os serviços", "/servicos"],
          ]}
        />
        <FooterCol
          title="Corretores"
          links={[
            ["Página grátis", "/corretores"],
            ["Entrar", "/corretores/entrar"],
            ["Política de privacidade", "/privacidade"],
          ]}
        />
      </div>
      <div className="border-t border-slate-800">
        <div className="mx-auto max-w-[1240px] px-4 py-6 text-xs leading-relaxed text-slate-400 sm:px-6">
          © {year} {PORTAL.legalName} · CNPJ {PORTAL.cnpj} · {PORTAL.address}. Atendimento em todo o
          Brasil.
          <br />
          Os imóveis da Caixa vêm da lista pública oficial da Caixa Econômica Federal; os de outros
          bancos e da Justiça, dos parceiros indicados em cada anúncio. Confira sempre o edital e a
          matrícula antes de qualquer lance.
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <span className="font-bold text-white">{title}</span>
      {links.map(([label, href]) => (
        <Link key={href} href={href} className="hover:text-white">
          {label}
        </Link>
      ))}
    </div>
  )
}
