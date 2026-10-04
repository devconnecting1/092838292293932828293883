import type { Metadata } from "next"

import { CtaBand, PageHero, Section, Steps } from "@/components/portal/content"

export const metadata: Metadata = {
  title: "Como funciona o leilão de imóveis",
  description:
    "O passo a passo do leilão de imóveis, do anúncio à chave, e a diferença entre comprar para morar e para investir.",
}

const PASSOS = [
  {
    t: "Encontre o imóvel",
    d: "Filtre por estado, cidade, tipo, desconto e se aceita financiamento.",
  },
  {
    t: "Leia o edital e a matrícula",
    d: "O edital diz as regras da venda; a matrícula mostra a situação do imóvel no cartório.",
  },
  {
    t: "Calcule o custo total",
    d: "Lance, comissão do leiloeiro, ITBI, registro, dívidas, desocupação e reforma.",
  },
  {
    t: "Cadastre-se no site da venda",
    d: "Habilitação no site do leiloeiro ou do banco, com documentos, antes da data.",
  },
  { t: "Dê o lance", d: "Defina o seu limite antes e não passe dele." },
  {
    t: "Pague e assine",
    d: "À vista ou financiado, conforme o edital, com assinatura do contrato ou da carta de arrematação.",
  },
  {
    t: "Registre no cartório",
    d: "Paga o ITBI e registra. A partir daí, o imóvel está no seu nome.",
  },
  {
    t: "Receba as chaves",
    d: "Se estiver ocupado, há a desocupação: amigável, por acordo, ou pela Justiça.",
  },
]

const LINHAS: [string, string, string][] = [
  [
    "Objetivo",
    "Ter o próprio imóvel pagando menos.",
    "Comprar abaixo do valor e lucrar na revenda ou no aluguel.",
  ],
  [
    "O que mais pesa",
    "Localização, estado do imóvel e tempo até poder morar.",
    "Desconto real depois dos custos e liquidez do bairro.",
  ],
  [
    "Pagamento",
    "À vista ou financiado, quando o edital permite.",
    "Geralmente à vista, pela agilidade.",
  ],
  [
    "Prazo",
    "Se estiver ocupado, a desocupação pode levar meses.",
    "Cada mês parado custa condomínio, IPTU e dinheiro imobilizado.",
  ],
  [
    "Cuidado principal",
    "Somar todos os custos para não estourar o orçamento.",
    "Olhar o lucro líquido, não só o desconto.",
  ],
]

export default function ComoFuncionaPage() {
  return (
    <>
      <PageHero
        kicker="Comprar com segurança"
        title="Como funciona o leilão de imóveis"
        text="Bancos e a Justiça vendem imóveis por leilão para recuperar dívidas. Por isso o preço costuma ficar abaixo da avaliação. Em troca, quem compra precisa ler o edital com atenção e fazer a conta completa antes do lance."
      />
      <Section title="O caminho, do anúncio à chave">
        <Steps items={PASSOS} />
        <p className="text-sm text-slate-500">
          Cada edital tem regras próprias. O edital sempre prevalece.
        </p>
      </Section>
      <Section id="perfis" title="Para morar ou para investir: a diferença" muted>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-4" />
                <th className="p-4 font-extrabold">Comprador final</th>
                <th className="p-4 font-extrabold">Investidor</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS.map(([k, a, b]) => (
                <tr key={k} className="border-t border-slate-100 align-top">
                  <th className="p-4 font-bold">{k}</th>
                  <td className="p-4 text-slate-700">{a}</td>
                  <td className="p-4 text-slate-700">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <CtaBand
        title="Quer ajuda com o seu primeiro leilão?"
        text="Um corretor parceiro acompanha você do edital à chave, em todo o Brasil."
        href="/leiloes"
        label="Ver imóveis"
      />
    </>
  )
}
