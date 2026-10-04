import type { Metadata } from "next"

import { CtaBand, PageHero, Section, Steps } from "@/components/portal/content"
import { whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Notificação extrajudicial",
  description:
    "Notificação extrajudicial com prova de entrega para cobrança, pedido de desocupação ou rescisão. Atendimento em todo o Brasil.",
}

export default function NotificacaoPage() {
  return (
    <>
      <PageHero
        kicker="Serviço em destaque · todo o Brasil"
        title="Notificação extrajudicial"
        text="É o aviso formal, por escrito e com prova de entrega, que registra um pedido antes de qualquer processo. Muitas vezes resolve o problema sem precisar de Justiça."
      >
        <a
          href={whatsappHref("Olá! Preciso de uma notificação extrajudicial.")}
          className="mt-2 self-start rounded-xl bg-[var(--brand)] px-6 py-4 font-extrabold text-white"
        >
          Quero notificar
        </a>
      </PageHero>
      <Section title="Quando usar">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            [
              "Imóvel arrematado ocupado",
              "Comunicar o ocupante da compra e abrir a negociação de saída.",
            ],
            ["Aluguel ou condomínio em atraso", "Cobrar formalmente e marcar prazo para pagar."],
            [
              "Fim de contrato de locação",
              "Avisar a intenção de não renovar ou pedir o imóvel de volta.",
            ],
            ["Descumprimento de contrato", "Registrar o problema e dar prazo para a correção."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl border border-slate-200 p-5">
              <span className="font-extrabold">{t}</span>
              <p className="mt-1 leading-relaxed text-slate-600">{d}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Como funciona" muted>
        <Steps
          items={[
            {
              t: "Conversa e documentos",
              d: "Você conta a situação e envia o contrato, a matrícula ou a carta de arrematação.",
            },
            {
              t: "Redação da notificação",
              d: "Texto claro, com o pedido, o prazo e o que acontece se não houver resposta.",
            },
            {
              t: "Envio com prova",
              d: "Pelo meio mais adequado ao caso: cartório, carta com aviso de recebimento ou meio eletrônico com comprovação de entrega.",
            },
            {
              t: "Acompanhamento",
              d: "Recebemos a resposta e orientamos o próximo passo: acordo, nova tentativa ou caminho judicial com advogado.",
            },
          ]}
        />
        <p className="text-sm text-slate-500">
          Quando o caso exige análise jurídica, a notificação é feita por advogado, em contrato
          próprio.
        </p>
      </Section>
      <CtaBand
        title="Resolva antes de ir à Justiça"
        text="Envie a sua situação e receba o orçamento da notificação."
        href={whatsappHref("Olá! Preciso de uma notificação extrajudicial.")}
        label="Pedir orçamento"
      />
    </>
  )
}
