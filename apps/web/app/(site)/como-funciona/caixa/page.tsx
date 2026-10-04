import type { Metadata } from "next"
import Link from "next/link"

import { CtaBand, PageHero, Section } from "@/components/portal/content"
import { AssessoriaForm } from "@/components/portal/assessoria-form"
import { FinancingSimulator } from "@/components/portal/financing-simulator"
import { credenciais, PORTAL, whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Como funciona o leilão da Caixa: 1º e 2º leilão, licitação aberta e venda direta",
  description:
    "Entenda cada modalidade de venda da Caixa, a comissão do leiloeiro, quem paga condomínio e IPTU, simule o financiamento e conte com assessoria até a entrega da chave.",
}

const MODALIDADES = [
  {
    t: "1º leilão",
    d: "É o primeiro leilão depois que a Caixa retoma o imóvel do antigo dono que deixou de pagar o financiamento. É um leilão extrajudicial, feito por leiloeiro oficial, e o lance mínimo costuma ficar perto do valor de avaliação.",
    leiloeiro: true,
  },
  {
    t: "2º leilão",
    d: "Se ninguém compra no 1º leilão, o imóvel vai para o 2º, com lance mínimo menor. Também é conduzido por leiloeiro oficial.",
    leiloeiro: true,
  },
  {
    t: "Licitação aberta",
    d: "Imóveis que já são da Caixa e que ela coloca em disputa, com data marcada e valor mínimo. Ganha a maior proposta.",
    leiloeiro: true,
  },
  {
    t: "Venda online",
    d: "Disputa pela internet, com prazo para terminar. Quem der o maior lance até o fim leva o imóvel.",
    leiloeiro: false,
  },
  {
    t: "Venda direta online",
    d: "O imóvel fica à venda por um preço fixo e quem fizer primeiro a proposta pelo valor pedido leva. É a modalidade mais rápida.",
    leiloeiro: false,
  },
]

export default function LeilaoCaixaPage() {
  return (
    <>
      <div className="h-1.5 bg-[linear-gradient(90deg,#005CA9_70%,#F39200_70%)]" />
      <PageHero
        kicker="Leilão da Caixa explicado"
        title="Do 1º leilão à venda direta: entenda cada etapa antes de comprar."
        text="A Caixa vende imóveis retomados em várias modalidades. Cada uma tem regras próprias de preço, de pagamento e de custos. Explicamos de um jeito simples."
      >
        <div className="flex flex-wrap gap-3">
          <Link
            href="/simulador"
            className="rounded-xl bg-[#005CA9] px-6 py-3.5 font-bold text-white"
          >
            Ver o simulador de proposta
          </Link>
          <Link
            href="/leiloes?origem=caixa"
            className="rounded-xl border-[1.5px] border-[#F39200] bg-white px-6 py-3.5 font-bold text-[#B45309]"
          >
            Imóveis da Caixa
          </Link>
        </div>
      </PageHero>

      <Section title="As modalidades de venda">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODALIDADES.map((m, i) => (
            <div key={m.t} className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-5">
              <span className="grid size-7 place-items-center rounded-full bg-[#F39200] text-sm font-extrabold text-white">
                {i + 1}
              </span>
              <h3 className="text-lg font-extrabold">{m.t}</h3>
              <p className="leading-relaxed text-slate-700">{m.d}</p>
              <span
                className={`mt-auto self-start rounded-full px-3 py-1 text-xs font-bold ${m.leiloeiro ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
              >
                {m.leiloeiro ? "Tem comissão de leiloeiro (5%)" : "Sem comissão de leiloeiro"}
              </span>
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-500">
          A comissão do leiloeiro é paga por quem arremata, além do valor do lance. Confira sempre
          no edital de cada imóvel.
        </p>
      </Section>

      <Section id="assessoria" title="Podemos te ajudar melhor" muted>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <div className="flex flex-col gap-4">
            <p className="max-w-2xl text-lg leading-relaxed text-slate-700">
              Comprar sozinho parece economia, mas costuma sair caro: edital mal lido, dívida que
              aparece depois, ocupante que não sai, cartório que devolve a escritura. A assessoria
              custa pouco perto do que está em jogo, e o valor dela não paga o seu estresse.
            </p>
            <p className="max-w-2xl text-lg leading-relaxed font-bold text-slate-900">
              Você paga a assessoria e recebe a chave na mão.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                [
                  "Análise antes do lance",
                  "Leitura do edital e da matrícula, conta de custos e o lance máximo que ainda dá lucro.",
                ],
                [
                  "Dívidas levantadas",
                  "IPTU, condomínio e processos ligados ao imóvel, com o que fica por sua conta e o que fica com o banco.",
                ],
                [
                  "Negociação extrajudicial incluída",
                  "Conversamos com o ocupante para a saída amigável, sem esperar uma imissão na posse pela Justiça.",
                ],
                [
                  "Documentação até o registro",
                  "Acompanhamos pagamento, ITBI, escritura e registro até o imóvel estar no seu nome.",
                ],
              ].map(([t, d]) => (
                <li key={t} className="rounded-2xl bg-white p-5">
                  <span className="font-extrabold">{t}</span>
                  <p className="mt-1 leading-relaxed text-slate-700">{d}</p>
                </li>
              ))}
            </ul>
            <p className="max-w-2xl leading-relaxed text-slate-700">
              A negociação amigável também ajuda quando o caso precisa ir para a Justiça: a
              tentativa de acordo fica registrada e muitas vezes encurta o caminho.
            </p>
            <p className="text-sm text-slate-500">Serviço prestado por {credenciais()}.</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-lg font-extrabold">Peça sua assessoria</h3>
            <AssessoriaForm aberto />
          </div>
        </div>
      </Section>

      <Section title="O que verificar antes de dar o lance">
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            [
              "IPTU",
              "Consulte na prefeitura se há IPTU em atraso e de quem é a responsabilidade pelo edital.",
            ],
            [
              "Condomínio",
              "Peça ao condomínio a declaração de débitos. Em muitos editais da Caixa, o comprador paga as dívidas de condomínio até 10% do valor de avaliação e a Caixa assume o que passar disso.",
            ],
            [
              "Ocupação",
              "Veja se o imóvel está ocupado. Se estiver, a saída do ocupante pode ser negociada (imissão na posse amigável) ou pedida na Justiça.",
            ],
            [
              "Matrícula e edital",
              "Leia a matrícula atualizada e o edital inteiro: eles dizem as condições de pagamento, os custos e as responsabilidades.",
            ],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl border border-slate-200 p-5">
              <span className="font-extrabold">{t}</span>
              <p className="mt-1 leading-relaxed text-slate-700">{d}</p>
            </li>
          ))}
        </ul>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h3 className="font-extrabold text-emerald-900">Pré-análise grátis</h3>
          <p className="mt-1 leading-relaxed text-emerald-900">
            Verificamos sem custo se existe processo judicial ativo ligado ao imóvel, contra a Caixa
            ou de execução da dívida. Quando há execução, informamos o valor em discussão.
          </p>
        </div>
        <p className="leading-relaxed text-slate-700">
          De tempos em tempos a Caixa faz campanhas em que assume despesas do comprador, como
          dívidas de condomínio ou custos de documentação. Isso acontece poucas vezes por ano e as
          regras ficam no edital de cada campanha.
        </p>
      </Section>

      <Section title="Faça a conta antes" muted>
        <p className="max-w-3xl leading-relaxed text-slate-700">
          Em cada imóvel do portal, a calculadora de viabilidade já vem preenchida com o valor e a
          avaliação. Se o condomínio estiver atrasado, marque &quot;dívidas anteriores&quot; e ela
          estima a sua parte. Assim você vê o custo total aproximado: lance, comissão do leiloeiro,
          ITBI, cartório, dívidas, reforma e revenda.
        </p>
        <Link
          href="/leiloes"
          className="self-start rounded-xl bg-[var(--brand)] px-6 py-3.5 font-bold text-white"
        >
          Escolher um imóvel e calcular
        </Link>
      </Section>

      <Section title="Simule o financiamento">
        <p className="max-w-3xl leading-relaxed text-slate-700">
          Boa parte dos imóveis da Caixa aceita financiamento. Coloque o valor do imóvel e a sua
          renda: a simulação usa as referências da Caixa e, se quiser, você envia o resultado para a
          nossa equipe.
        </p>
        <FinancingSimulator />
        <Link href="/simulador" className="self-start font-bold text-[#005CA9]">
          Quer ver uma proposta completa, passo a passo? Abra o simulador de proposta.
        </Link>
      </Section>

      <CtaBand
        title="Receba a pré-análise de um imóvel"
        text="Mande o código do imóvel e checamos se há processo judicial ativo, sem custo."
        href={whatsappHref("Olá! Quero verificar se um imóvel da Caixa tem processo judicial.")}
        label="Receber pré-análise"
      />
    </>
  )
}
