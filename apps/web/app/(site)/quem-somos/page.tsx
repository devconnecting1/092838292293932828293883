import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { Responsavel } from "@/components/portal/responsavel"
import { PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Quem somos",
  description: `${PORTAL.name}: assessoria em leilão de imóveis com responsável técnico, equipe multidisciplinar e tecnologia.`,
}

export default function QuemSomosPage() {
  return (
    <>
      <PageHero
        kicker="Quem somos"
        title="Gente que entende de leilão, do edital à chave."
        text={`O ${PORTAL.name} é o portal de leilões de imóveis da ${PORTAL.legalName}. Juntamos corretores, avaliadores, apoio jurídico especializado e tecnologia para que cada cliente compre com segurança.`}
      />
      <Section title="Responsável técnico">
        <Responsavel />
      </Section>
      <Section title="Como trabalhamos" muted>
        <ul className="grid gap-3 md:grid-cols-3">
          {[
            [
              "Análise antes do lance",
              "Edital, matrícula, dívidas e processo conferidos com ferramentas próprias.",
            ],
            [
              "Equipe multidisciplinar",
              "Corretores, avaliadores e apoio jurídico especializado, cada um no seu papel.",
            ],
            [
              "Tecnologia",
              "Calculadora de viabilidade, consulta processual e leitura de certidões para decidir com números.",
            ],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl bg-white p-5">
              <b>{t}</b>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{d}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
