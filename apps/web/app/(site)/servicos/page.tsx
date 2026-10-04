import type { Metadata } from "next"
import Link from "next/link"

import { CtaBand, PageHero } from "@/components/portal/content"
import { whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Serviços para comprar, vender e regularizar imóveis",
  description:
    "Avaliação, diligência, notificação extrajudicial, imissão na posse amigável, vistorias e regularização, em todo o Brasil.",
}

type Item = { t: string; d: string; preco: string; href?: string; destaque?: boolean }

const ETAPAS: { n: number; t: string; itens: Item[] }[] = [
  {
    n: 1,
    t: "Antes de decidir",
    itens: [
      {
        t: "Avaliação mercadológica (PTAM)",
        d: "Quanto o imóvel vale hoje, por comparação com negócios reais.",
        preco: "R$ 1.500 (até 500 m²)",
      },
      {
        t: "Diligência no local",
        d: "Visita com fotos: estado de conservação, ocupação, entorno e vizinhança.",
        preco: "Sob orçamento",
      },
      {
        t: "Levantamento de débitos",
        d: "Condomínio, IPTU, água, luz e gás antes do lance.",
        preco: "Sob orçamento",
      },
      {
        t: "Análise de edital e matrícula",
        d: "Leitura linha a linha: ônus, penhoras e indisponibilidades.",
        preco: "Sob orçamento",
      },
    ],
  },
  {
    n: 2,
    t: "Compra e leilão",
    itens: [
      {
        t: "Assessoria em leilão",
        d: "A jornada completa, do edital à chave.",
        preco: "Sob orçamento",
      },
      {
        t: "Imissão na posse amigável",
        d: "Negociação com o ocupante, prazo e termo de desocupação assinado.",
        preco: "Sob orçamento",
        href: "/servicos/imissao-na-posse-amigavel",
        destaque: true,
      },
      {
        t: "Notificação extrajudicial",
        d: "Aviso formal com prova de entrega: cobrança, desocupação ou rescisão.",
        preco: "Sob orçamento",
        href: "/servicos/notificacao-extrajudicial",
        destaque: true,
      },
      {
        t: "Pesquisa e captação dirigida",
        d: "Busca do imóvel certo para o seu perfil.",
        preco: "Sob orçamento",
      },
    ],
  },
  {
    n: 3,
    t: "Venda e locação",
    itens: [
      {
        t: "Intermediação completa",
        d: "Divulgação, atendimento, visitas, propostas e negociação.",
        preco: "Sob orçamento",
      },
      {
        t: "Vistoria de entrada e saída",
        d: "Estado do imóvel no início e no fim da locação, com fotos.",
        preco: "A partir de R$ 397",
      },
      {
        t: "Locação sem fiador",
        d: "Garantia locatícia para o inquilino.",
        preco: "Sob orçamento",
      },
    ],
  },
  {
    n: 4,
    t: "Documentos e regularização",
    itens: [
      {
        t: "Vistoria de imóvel novo",
        d: "Na entrega das chaves, antes de aceitar o imóvel.",
        preco: "A partir de R$ 600",
      },
      {
        t: "Legalização do imóvel",
        d: "Visita técnica de viabilidade com medição, croqui e análise de documentos.",
        preco: "Visita R$ 600 (abatida do projeto)",
      },
      {
        t: "Contratos imobiliários",
        d: "Compra e venda, locação e cessão de direitos.",
        preco: "Sob orçamento",
      },
      {
        t: "Usucapião e inventário extrajudiciais",
        d: "Direto no cartório.",
        preco: "Sob orçamento",
      },
    ],
  },
  {
    n: 5,
    t: "Cobrança e proteção",
    itens: [
      {
        t: "Cobrança extrajudicial",
        d: "Aluguel, condomínio e parcelas, primeiro por acordo.",
        preco: "Sob orçamento",
      },
      {
        t: "Análise cadastral do pretendente",
        d: "Identidade, renda e restrições do inquilino.",
        preco: "Sob orçamento",
      },
      {
        t: "Pós-aquisição",
        d: "Registro da escritura e transferência das contas.",
        preco: "Sob orçamento",
      },
    ],
  },
]

export default function ServicosPage() {
  return (
    <>
      <PageHero
        kicker="Atendimento em todo o Brasil"
        title="Tudo o que o seu imóvel precisa, do primeiro olhar à chave na mão."
        text="Serviços técnicos feitos por corretores, avaliadores, engenheiros e arquitetos da rede. Quando o caso pede advogado, o serviço jurídico é contratado à parte, com advogado especializado."
      />
      <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 py-12 sm:px-6">
        {ETAPAS.map((e) => (
          <section key={e.n} id={`etapa-${e.n}`} className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-sm font-extrabold text-[var(--brand)]">Etapa {e.n}</span>
              <h2 className="text-2xl font-extrabold tracking-tight">{e.t}</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {e.itens.map((s) => {
                const body = (
                  <>
                    {s.destaque ? (
                      <span className="self-start rounded-full bg-[var(--brand)] px-2.5 py-0.5 text-xs font-bold text-white">
                        Destaque
                      </span>
                    ) : null}
                    <span className="font-extrabold">{s.t}</span>
                    <span className="flex-1 text-sm leading-relaxed text-slate-600">{s.d}</span>
                    <span className="text-sm font-extrabold">{s.preco}</span>
                    {s.href ? (
                      <span className="text-sm font-bold text-[var(--brand)]">Como funciona</span>
                    ) : null}
                  </>
                )
                const cls = `flex flex-col gap-2 rounded-2xl border p-5 ${s.destaque ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-slate-200"}`
                return s.href ? (
                  <Link key={s.t} href={s.href} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div key={s.t} className={cls}>
                    {body}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        <p className="text-xs text-slate-500">
          Valores de vistoria, avaliação e legalização conforme a tabela da Vistoria Legal. Demais
          serviços sob orçamento.
        </p>
      </div>
      <CtaBand
        title="Precisa de um desses serviços?"
        text="Fale com a nossa equipe e receba o orçamento."
        href={whatsappHref("Olá! Quero um orçamento de serviço.")}
        label="Pedir orçamento"
      />
    </>
  )
}
