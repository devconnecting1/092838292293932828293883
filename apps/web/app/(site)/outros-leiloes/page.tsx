import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, Section, Steps } from "@/components/portal/content"
import { GUIAS } from "@/lib/portal/leiloes-bens"

export const metadata: Metadata = {
  title: "Leilão de veículos, máquinas agrícolas, animais e outros bens",
  description:
    "Guias simples e assessoria completa para arrematar carros, motos, caminhões, tratores, gado e outros bens em leilões oficiais.",
}

export default function OutrosLeiloesPage() {
  return (
    <>
      <PageHero
        kicker="Leilões oficiais de bens"
        title="Carro, máquina, gado ou equipamento de leilão, com a conta feita antes do lance."
        text="Trabalhamos só com leilão oficial, conduzido por leiloeiro matriculado na Junta Comercial ou determinado pela Justiça. Escolha o tipo de bem para entender como funciona, calcular o custo e pedir assessoria."
      >
        <Link
          href="/calculadora-leilao-veiculos"
          className="self-start rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white"
        >
          Calculadora de leilão de veículos
        </Link>
      </PageHero>
      <Section title="Escolha o tipo de leilão">
        <div className="grid gap-4 sm:grid-cols-2">
          {GUIAS.map((g) => (
            <Link
              key={g.id}
              href={`/${g.slug}`}
              className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-5 hover:border-[var(--brand)]"
            >
              <span className="text-xl font-extrabold">{g.titulo}</span>
              <span className="text-slate-600">{g.chamada}</span>
              <span className="text-sm font-bold text-[var(--brand)]">Ver o guia e calcular →</span>
            </Link>
          ))}
        </div>
      </Section>
      <Section title="Como a assessoria funciona" muted>
        <Steps
          items={[
            {
              t: "Você escolhe o lote",
              d: "No site do leiloeiro, ou nos manda o link para a gente avaliar.",
            },
            {
              t: "A gente lê e confere tudo",
              d: "Edital, documentos, restrições, débitos e, quando possível, o bem de perto.",
            },
            {
              t: "Conta completa e lance máximo",
              d: "Você sabe exatamente até onde vale ir antes do pregão.",
            },
            {
              t: "Do lance à retirada",
              d: "Cadastro, pregão, pagamento, retirada, transporte e regularização.",
            },
          ]}
        />
      </Section>
      <Section title="E imóveis?">
        <p className="text-slate-700">
          Imóveis de leilão estão na{" "}
          <Link href="/leiloes" className="font-bold text-[var(--brand)]">
            busca de imóveis
          </Link>
          , com a calculadora de viabilidade e a assessoria até a chave na mão.
        </p>
      </Section>
    </>
  )
}
