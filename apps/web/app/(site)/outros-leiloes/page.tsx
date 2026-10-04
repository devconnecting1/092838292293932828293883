import type { Metadata } from "next"
import Link from "next/link"

import { AssessoriaForm } from "@/components/portal/assessoria-form"
import { CalculadoraBens } from "@/components/portal/calculadora-bens"
import { PageHero, Section, Steps } from "@/components/portal/content"
import { lerConfigPortal, reais } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Leilão de veículos, máquinas agrícolas, animais e outros bens",
  description:
    "Assessoria completa para arrematar carros, motos, caminhões, tratores, gado e outros bens em leilões oficiais: análise do edital, custo total, lance e retirada.",
}

export const revalidate = 300

type Cat = {
  id: "veiculos" | "agro" | "animais" | "diversos"
  titulo: string
  exemplos: string
  conferir: string[]
}

const CATEGORIAS: Cat[] = [
  {
    id: "veiculos",
    titulo: "Veículos",
    exemplos:
      "Carros, motos, caminhões, ônibus e utilitários de bancos, seguradoras, frotas e da Justiça.",
    conferir: [
      "Se o lote é documentado (pode voltar a rodar) ou vendido como sucata ou peças.",
      "IPVA, multas, licenciamento e financiamento: quem paga cada débito segundo o edital.",
      "Origem do veículo: recuperado de financiamento, frota, sinistro ou apreensão.",
      "Vistoria no pátio antes do lance, prazo de retirada e custo de diárias.",
    ],
  },
  {
    id: "agro",
    titulo: "Agro e máquinas",
    exemplos:
      "Tratores, colheitadeiras, implementos, caminhões de frota rural, equipamentos e safra.",
    conferir: [
      "Horas de uso, estado de conservação e manutenção registrada.",
      "Nota fiscal, documento do bem e restrições como alienação ou penhora.",
      "Local de retirada, frete especial e seguro do transporte.",
      "Imóvel rural vai pela nossa assessoria de imóveis, com análise da matrícula.",
    ],
  },
  {
    id: "animais",
    titulo: "Animais",
    exemplos: "Gado de corte e de leite, reprodutores, equinos e outros leilões rurais.",
    conferir: [
      "Atestados sanitários e exames pedidos no edital e pelo órgão de defesa do seu estado.",
      "Guia de Trânsito Animal (GTA) para levar os animais até a sua propriedade.",
      "Forma de pagamento: à vista ou parcelado, com as garantias exigidas.",
      "Frete, quarentena e quem responde pelo animal até a entrega.",
    ],
  },
  {
    id: "diversos",
    titulo: "Outros bens",
    exemplos: "Equipamentos, eletrônicos, mobiliário, embarcações e bens de empresas e da Justiça.",
    conferir: [
      "Descrição do lote e estado: o bem costuma ser vendido no estado em que está.",
      "Comissão do leiloeiro, taxas e impostos do arremate.",
      "Prazo e local de retirada.",
      "Documentação para registrar ou revender o bem.",
    ],
  },
]

export default async function OutrosLeiloesPage() {
  const precos = (await lerConfigPortal()).assessoria_bens
  return (
    <>
      <PageHero
        kicker="Leilões oficiais de bens"
        title="Carro, máquina, gado ou equipamento de leilão, com a conta feita antes do lance."
        text="Trabalhamos só com leilão oficial, conduzido por leiloeiro matriculado na Junta Comercial ou determinado pela Justiça. Você escolhe o lote e nós cuidamos do resto: edital, custo total, lance e retirada."
      >
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
            >
              {c.titulo}
            </a>
          ))}
          <a
            href="#calculadora"
            className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white"
          >
            Calcular meu arremate
          </a>
        </div>
      </PageHero>

      <Section title="Consultoria completa, do edital à retirada">
        <Steps
          items={[
            {
              t: "Análise do lote e do edital",
              d: "Lemos o edital inteiro: condições, débitos, comissão, prazos e o que fica com você.",
            },
            {
              t: "Checagem do bem",
              d: "Conferimos documentos, restrições, processos e, quando possível, a vistoria no local.",
            },
            {
              t: "Custo total e lance máximo",
              d: "Somamos lance, comissão, taxas, débitos, frete e regularização e definimos até onde vale ir.",
            },
            {
              t: "Cadastro e lance",
              d: "Ajudamos no cadastro com o leiloeiro e acompanhamos o pregão com você.",
            },
            {
              t: "Pós-arremate",
              d: "Pagamento, nota de arrematação, retirada, transporte e transferência para o seu nome.",
            },
          ]}
        />
      </Section>

      {CATEGORIAS.map((c, i) => (
        <Section key={c.id} id={c.id} title={c.titulo} muted={i % 2 === 0}>
          <p className="text-lg text-slate-700">{c.exemplos}</p>
          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <div className="flex flex-col gap-2">
              <h3 className="font-extrabold">O que conferimos antes do lance</h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-slate-700">
                {c.conferir.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {precos[c.id] ? (
                <p className="mt-2 font-bold">Assessoria a partir de {reais(precos[c.id])}.</p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  O valor da assessoria vem no orçamento, conforme o lote.
                </p>
              )}
            </div>
            <AssessoriaForm
              categoria={c.titulo}
              titulo={`leilão de ${c.titulo.toLowerCase()}`}
              rotulo={`Quero assessoria em ${c.titulo.toLowerCase()}`}
            />
          </div>
        </Section>
      ))}

      <Section id="calculadora" title="Calculadora do arremate">
        <CalculadoraBens />
      </Section>

      <Section title="E imóveis?" muted>
        <p className="text-slate-700">
          Imóveis de leilão da Caixa, de outros bancos e da Justiça estão na{" "}
          <Link href="/leiloes" className="font-bold text-[var(--brand)]">
            busca de imóveis
          </Link>
          , com a calculadora de viabilidade e a assessoria até a chave na mão.
        </p>
      </Section>
    </>
  )
}
