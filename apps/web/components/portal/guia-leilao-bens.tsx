import Link from "next/link"

import { AssessoriaForm } from "@/components/portal/assessoria-form"
import { CalculadoraAnimais } from "@/components/portal/calculadora-animais"
import { CalculadoraBens } from "@/components/portal/calculadora-bens"
import { CalculadoraVeiculos } from "@/components/portal/calculadora-veiculos"
import { PageHero, Section, Steps } from "@/components/portal/content"
import { lerConfigPortal, pct, reais } from "@/lib/portal/config-portal"
import { FONTES, GUIAS, type GuiaBem } from "@/lib/portal/leiloes-bens"

/** Guia completo de um tipo de leilão de bens: explicação, custos, cuidados, calculadora e assessoria. */
export async function GuiaLeilaoBens({ guia }: { guia: GuiaBem }) {
  const cfg = (await lerConfigPortal()).assessoria_bens
  const preco = cfg[guia.id]
  const fontes = [
    FONTES.comissao,
    ...(guia.id === "veiculos" ? [FONTES.isencao, FONTES.aliquota] : []),
    ...(guia.id === "animais" ? [FONTES.sanidade] : []),
  ]
  return (
    <>
      <PageHero kicker={guia.titulo} title={guia.chamada} text={guia.intro}>
        <div className="flex flex-wrap gap-2">
          <a
            href="#calculadora"
            className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white"
          >
            Calcular meu arremate
          </a>
          <a
            href="#assessoria"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
          >
            Quero assessoria
          </a>
          {GUIAS.filter((g) => g.id !== guia.id).map((g) => (
            <Link
              key={g.id}
              href={`/${g.slug}`}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold"
            >
              {g.curto}
            </Link>
          ))}
        </div>
      </PageHero>

      <Section title="Quem vende nesses leilões">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guia.quemVende.map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-slate-200 p-4">
              <b>{t}</b>
              <p className="text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipos de lote" muted>
        <div className="grid gap-3 sm:grid-cols-2">
          {guia.tiposLote.map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-slate-200 bg-white p-4">
              <b>{t}</b>
              <p className="text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Passo a passo, do edital à retirada">
        <Steps items={guia.passos} />
      </Section>

      <Section title="O que entra no custo" muted>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-slate-700">
          {guia.custos.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>

      <Section title="Cuidados antes do lance">
        <ul className="flex flex-col gap-2">
          {guia.cuidados.map((c) => (
            <li key={c} className="flex gap-3 rounded-xl bg-amber-50 p-3 text-slate-800">
              <span className="font-extrabold text-amber-700">!</span>
              {c}
            </li>
          ))}
        </ul>
      </Section>

      <section id="calculadora" className="scroll-mt-20 border-y border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-12 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Calculadora do arremate</h2>
          {guia.id === "veiculos" ? (
            <CalculadoraVeiculos />
          ) : guia.id === "animais" ? (
            <CalculadoraAnimais />
          ) : (
            <CalculadoraBens />
          )}
        </div>
      </section>

      <Section id="assessoria" title="Assessoria completa">
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-3 text-slate-700">
            <p>
              Você escolhe o lote e nós cuidamos do resto: leitura do edital, checagem do bem e dos
              documentos, conta completa com lance máximo, cadastro, acompanhamento do pregão,
              pagamento, retirada e regularização.
            </p>
            <p className="font-bold text-slate-900">
              {preco
                ? `Assessoria a partir de ${reais(preco)}.`
                : "O valor vem no orçamento, conforme o lote."}
            </p>
            <p className="text-sm">
              Trabalhamos só com leilão oficial: leiloeiro matriculado na Junta Comercial ou leilão
              determinado pela Justiça.
            </p>
          </div>
          <AssessoriaForm
            aberto
            categoria={guia.curto}
            titulo={guia.titulo.toLowerCase()}
            rotulo={`Quero assessoria em ${guia.curto.toLowerCase()}`}
          />
        </div>
      </Section>

      <Section title="Perguntas frequentes" muted>
        <div className="flex flex-col gap-2">
          {guia.faq.map(([p, r]) => (
            <details key={p} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-bold">{p}</summary>
              <p className="mt-2 text-slate-700">{r}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="É corretor?">
        <p className="text-slate-700">
          Corretor e imobiliária parceiros podem oferecer esta assessoria aos próprios clientes. A
          nossa equipe faz o trabalho técnico e o parceiro recebe{" "}
          {cfg.indicacao_pct ? (
            <b>{pct(cfg.indicacao_pct)} do valor da assessoria</b>
          ) : (
            "a comissão definida no contrato de parceria"
          )}{" "}
          por cliente que fechar.{" "}
          <Link href="/corretores" className="font-bold text-[var(--brand)]">
            Quero ser parceiro
          </Link>
        </p>
        <div className="text-xs text-slate-500">
          <b>Fontes:</b>
          <ul className="mt-1 flex flex-col gap-0.5">
            {fontes.map((f) => (
              <li key={f.url}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {f.rotulo}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Informação geral para orientar o cliente. Cada leilão tem regras próprias no edital.
          </p>
        </div>
      </Section>
    </>
  )
}
