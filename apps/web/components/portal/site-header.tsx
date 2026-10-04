"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react"

import { HeaderPhone } from "@/components/portal/contact-button"
import { Logo } from "@/components/portal/logo"
import { BotaoTema, SeletorIdioma } from "@/components/portal/tema-idioma"

type MenuLink = { label: string; href: string }
type MenuGroup = { title: string; links: MenuLink[] }
type MenuItem = { label: string; groups: MenuGroup[] }

export const PORTAL_MENU: MenuItem[] = [
  {
    label: "Leilões",
    groups: [
      {
        title: "Por banco",
        links: [
          { label: "Todos os leilões", href: "/leiloes" },
          { label: "Caixa", href: "/leiloes?origem=caixa" },
          { label: "Itaú", href: "/leiloes?origem=itau" },
          { label: "Bradesco", href: "/leiloes?origem=bradesco" },
          { label: "Santander", href: "/leiloes?origem=santander" },
          { label: "Banco do Brasil", href: "/leiloes?origem=banco-do-brasil" },
          { label: "Leilões judiciais", href: "/leiloes?origem=judicial" },
        ],
      },
      {
        title: "Oportunidades",
        links: [
          { label: "Maiores descontos", href: "/leiloes?desconto=50" },
          { label: "Aceitam financiamento", href: "/leiloes?financiamento=sim" },
        ],
      },
      {
        title: "Por estado",
        links: [
          { label: "Rio de Janeiro", href: "/leiloes?uf=RJ" },
          { label: "São Paulo", href: "/leiloes?uf=SP" },
          { label: "Minas Gerais", href: "/leiloes?uf=MG" },
          { label: "Todo o Brasil", href: "/leiloes" },
        ],
      },
    ],
  },
  {
    label: "Comprar com segurança",
    groups: [
      {
        title: "Entenda",
        links: [
          { label: "Como funciona o leilão", href: "/como-funciona" },
          { label: "Quem somos", href: "/quem-somos" },
          { label: "Leilão da Caixa explicado", href: "/como-funciona/caixa" },
          { label: "Como preencher a proposta da Caixa", href: "/simulador" },
          { label: "Para morar ou para investir", href: "/como-funciona#perfis" },
          { label: "Arremate em cotas", href: "/cotas" },
          { label: "Imóveis direto com o proprietário", href: "/imoveis-a-venda" },
          { label: "Anuncie seu imóvel grátis", href: "/anuncie-gratis" },
        ],
      },
      {
        title: "Ferramentas",
        links: [{ label: "Avalie seu crédito", href: "/credito" }],
      },
    ],
  },
  {
    label: "Serviços",
    groups: [
      {
        title: "Destaques",
        links: [
          { label: "Notificação extrajudicial", href: "/servicos/notificacao-extrajudicial" },
          { label: "Imissão na posse amigável", href: "/servicos/imissao-na-posse-amigavel" },
        ],
      },
      {
        title: "Todos os serviços",
        links: [
          { label: "Antes de decidir", href: "/servicos#etapa-1" },
          { label: "Compra e leilão", href: "/servicos#etapa-2" },
          { label: "Documentos e regularização", href: "/servicos#etapa-4" },
          { label: "Ver todos", href: "/servicos" },
        ],
      },
    ],
  },
  {
    label: "Corretores",
    groups: [
      {
        title: "Para você",
        links: [
          { label: "Página grátis com CRECI", href: "/corretores" },
          { label: "Selo Verde", href: "/corretores#selo-verde" },
          { label: "Parceria 50/50", href: "/corretores#parceria" },
          { label: "Planos", href: "/assinar" },
          { label: "Cadastre-se grátis", href: "/corretores/cadastro" },
          { label: "Entrar no painel", href: "/corretores/entrar" },
        ],
      },
      {
        title: "Ferramentas",
        links: [
          { label: "Anunciar nos portais", href: "/anunciar" },
          { label: "Calculadora de viabilidade", href: "/leiloes" },
          { label: "Kit de anúncio para redes", href: "/corretores/kit" },
          { label: "Processos, CPF e certidões", href: "/processos" },
          { label: "Seja parceiro", href: "/parceiros" },
          { label: "Imóveis avulsos", href: "/corretores/imoveis-avulsos" },
        ],
      },
    ],
  },
]

export function SiteHeader({
  name,
  logoUrl,
  phone,
}: {
  name: string
  logoUrl?: string
  phone?: { href: string; label: string }
}) {
  const [open, setOpen] = React.useState<number | null>(null)
  const [mobile, setMobile] = React.useState(false)

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(null)
        setMobile(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const close = () => {
    setOpen(null)
    setMobile(false)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link
          href="/"
          onClick={close}
          className="flex min-w-0 shrink items-center lg:shrink-0"
          aria-label={`${name}, página inicial`}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logomarca configurável por URL
            <img src={logoUrl} alt={name} className="h-11 w-auto" />
          ) : (
            <Logo nome={name} />
          )}
        </Link>

        <nav aria-label="Menu principal" className="hidden flex-1 items-center gap-0.5 lg:flex">
          {PORTAL_MENU.map((item, i) => (
            <button
              key={item.label}
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                open === i
                  ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "text-slate-900 hover:bg-slate-100"
              }`}
            >
              {item.label}
              <ChevronDownIcon
                className={`size-4 transition-transform ${open === i ? "rotate-180" : ""}`}
              />
            </button>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1.5 xl:flex">
            <SeletorIdioma />
            <BotaoTema />
          </div>
          {phone ? <HeaderPhone href={phone.href} label={phone.label} /> : null}
          <Link
            href="/corretores"
            className="hidden rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 sm:inline-flex"
          >
            Sou corretor
          </Link>
          <Link
            href="/minha-conta"
            className="rounded-lg bg-[var(--brand)] px-3 py-2.5 text-sm font-bold text-white hover:opacity-90 sm:px-4"
          >
            Entrar
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 lg:hidden"
            aria-label={mobile ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
      </div>

      {open !== null ? (
        <div className="hidden border-t border-slate-200 bg-white shadow-lg lg:block">
          <div className="mx-auto grid max-w-[1240px] grid-cols-4 gap-8 px-6 py-6">
            {PORTAL_MENU[open]!.groups.map((g) => (
              <div key={g.title} className="flex flex-col gap-2.5">
                <span className="text-xs font-extrabold tracking-wider text-slate-500 uppercase">
                  {g.title}
                </span>
                {g.links.map((l) => (
                  <Link
                    key={l.href + l.label}
                    href={l.href}
                    onClick={close}
                    className="text-[15px] font-semibold text-slate-900 hover:text-[var(--brand)]"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mobile ? (
        <div className="max-h-[80vh] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-6 lg:hidden">
          {PORTAL_MENU.map((item) => (
            <div key={item.label} className="border-b border-slate-100 py-3">
              <span className="text-sm font-extrabold text-slate-900">{item.label}</span>
              <div className="mt-2 flex flex-col gap-2 pl-2">
                {item.groups
                  .flatMap((g) => g.links)
                  .map((l) => (
                    <Link
                      key={l.href + l.label}
                      href={l.href}
                      onClick={close}
                      className="py-1 text-[15px] text-slate-700"
                    >
                      {l.label}
                    </Link>
                  ))}
              </div>
            </div>
          ))}
          <div className="mt-4 flex items-center gap-2">
            <SeletorIdioma />
            <BotaoTema />
          </div>
          <Link
            href="/corretores"
            onClick={close}
            className="mt-4 block rounded-lg border border-slate-300 px-4 py-3 text-center font-semibold"
          >
            Sou corretor
          </Link>
        </div>
      ) : null}
    </header>
  )
}
