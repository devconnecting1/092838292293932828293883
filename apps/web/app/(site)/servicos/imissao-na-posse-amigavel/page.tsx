import type { Metadata } from "next"

import { CtaBand, PageHero, Section, Steps } from "@/components/portal/content"
import { whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Imissão na posse amigável",
  description:
    "Arrematou um imóvel ocupado? Negociamos a saída do ocupante com prazo e termo assinado, sem ir à Justiça. Todo o Brasil.",
}

export default function ImissaoPage() {
  return (
    <>
      <PageHero
        kicker="Serviço em destaque · todo o Brasil"
        title="Imissão na posse amigável"
        text="Arrematou um imóvel e ele está ocupado? A imissão amigável é a saída negociada: o ocupante é notificado, as partes combinam o prazo e as condições, e tudo fica registrado num termo assinado. Sem processo e, na maioria das vezes, mais rápido."
      >
        <a
          href={whatsappHref(
            "Olá! Arrematei um imóvel ocupado e quero a imissão na posse amigável."
          )}
          className="mt-2 self-start rounded-xl bg-[var(--brand)] px-6 py-4 font-extrabold text-white"
        >
          Quero desocupar meu imóvel
        </a>
      </PageHero>
      <Section title="Como funciona">
        <Steps
          items={[
            {
              t: "Diligência no local",
              d: "Visita ao imóvel para saber quem ocupa, em que condições e qual o melhor caminho de conversa.",
            },
            {
              t: "Notificação do ocupante",
              d: "Aviso formal da compra, com prova de entrega, abrindo a negociação.",
            },
            {
              t: "Negociação",
              d: "Prazo de saída e, quando vale a pena, ajuda de custo para a mudança, combinados com você antes.",
            },
            {
              t: "Termo de desocupação",
              d: "Acordo por escrito, assinado, com data de entrega das chaves e multa se não for cumprido.",
            },
            {
              t: "Entrega das chaves com vistoria",
              d: "Conferência do estado do imóvel no dia da saída, com fotos.",
            },
          ]}
        />
      </Section>
      <Section title="E se não houver acordo?" muted>
        <p className="leading-relaxed text-slate-700">
          Se o ocupante não aceitar sair, o caminho é a ação judicial de imissão na posse, conduzida
          por advogado em contrato próprio. Tudo o que foi feito na fase amigável (notificação,
          propostas e tentativas) fica documentado e ajuda no processo.
        </p>
      </Section>
      <CtaBand
        title="Seu imóvel veio ocupado?"
        text="Conte o caso e receba o orçamento da imissão amigável."
        href={whatsappHref("Olá! Arrematei um imóvel ocupado e quero a imissão na posse amigável.")}
        label="Falar com a equipe"
      />
    </>
  )
}
