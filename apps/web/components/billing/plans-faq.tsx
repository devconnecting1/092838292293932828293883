import {
  AI_FIRST_PLAN,
  AI_OVERAGE_NOTE,
  ANNUAL_BOLETO_NOTE,
  formatBRL,
  GRACE_DAYS,
  IMPORTED_LISTINGS_NOTE,
  LISTING_PHOTO_SIZE_NOTE,
  OWNED_LISTING_RELEASED_STATUS_TEXT,
  PLAN_KEYS,
  PLANS,
  TRIAL_BASE_PLAN,
  TRIAL_DAYS,
} from "@workspace/core/billing"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"

import {
  ANNUAL_FREE_MONTHS,
  ANNUAL_RULE_SENTENCE,
  annualSavingsRange,
  CATALOG_ANNUAL_SAVINGS,
  pluralize,
} from "@/components/billing/plan-content"

const SMALLEST_PLAN = PLANS[PLAN_KEYS[0] ?? "corretor"]
const LARGEST_PLAN = PLANS[PLAN_KEYS[PLAN_KEYS.length - 1] ?? "rede"]

/** Meses grátis do anual só quando a razão do catálogo fecha; senão, nada de promessa. */
const FREE_MONTHS_NOTE = ANNUAL_FREE_MONTHS
  ? `, com ${pluralize(ANNUAL_FREE_MONTHS, "mês grátis", "meses grátis")}`
  : ""

const SAVINGS_RANGE = annualSavingsRange(CATALOG_ANNUAL_SAVINGS)

/**
 * Resposta sobre a economia do anual. Só aparece quando o catálogo realmente
 * tem economia: a comparação é com o preço mensal de hoje, nunca com preço
 * antigo (reajuste não é desconto).
 */
const ANNUAL_QUESTION = SAVINGS_RANGE
  ? [
      {
        id: "anual",
        question: "Quanto o plano anual economiza?",
        answer: [
          `No anual ${ANNUAL_RULE_SENTENCE}: a economia vai de ${formatBRL(SAVINGS_RANGE.min.savings.savings, { omitZeroCents: true })} por ano no plano ${PLANS[SAVINGS_RANGE.min.plan].name} a ${formatBRL(SAVINGS_RANGE.max.savings.savings, { omitZeroCents: true })} por ano no plano ${PLANS[SAVINGS_RANGE.max.plan].name}.`,
          `A conta é sempre contra o preço mensal de hoje: ${formatBRL(SAVINGS_RANGE.min.savings.monthlyPerYear, { omitZeroCents: true })} por ano pagando mês a mês no ${PLANS[SAVINGS_RANGE.min.plan].name}, contra ${formatBRL(SAVINGS_RANGE.min.savings.yearlyTotal, { omitZeroCents: true })} à vista no anual. Cada cartão mostra a economia do plano dele.`,
          "Se cancelar antes do fim do ano, você perde só o desconto — não há multa.",
        ],
      },
    ]
  : []

const QUESTIONS: ReadonlyArray<{ id: string; question: string; answer: string[] }> = [
  {
    id: "teste",
    question: "O teste grátis pede cartão?",
    answer: [
      `Não. São ${TRIAL_DAYS} dias com os recursos do plano ${PLANS[TRIAL_BASE_PLAN].name}, menos a IA, sem cartão e sem compromisso. Você escolhe o plano só se quiser continuar.`,
      "A IA começa quando você assina um plano com IA.",
    ],
  },
  {
    id: "pagamento",
    question: "Quais são as formas de pagamento?",
    answer: [
      "Cartão de crédito, com cobrança recorrente, e boleto bancário.",
      `${ANNUAL_BOLETO_NOTE}.`,
      `Pix e parcelamento ainda não estão disponíveis. O plano anual é pago à vista${FREE_MONTHS_NOTE}.`,
    ],
  },
  ...ANNUAL_QUESTION,
  {
    id: "nota-fiscal",
    question: "Vocês emitem nota fiscal?",
    answer: [
      "A emissão automática da nota fiscal está em implantação. No pagamento, você já informa o CPF ou CNPJ que vai na nota.",
    ],
  },
  {
    id: "fim-do-teste",
    question: "O que acontece quando o teste termina?",
    answer: [
      `Se você ainda não assinou, a conta segue com acesso completo por mais ${GRACE_DAYS} dias. Depois, entra em modo leitura: você continua vendo e exportando tudo, mas não cria nem edita.`,
      "Nada é apagado, e as suas landing pages continuam captando leads. Ao assinar, tudo volta a funcionar na hora.",
    ],
  },
  {
    id: "conversa-ia",
    question: "O que é uma conversa de IA?",
    answer: [
      "É um lead atendido pelo agente de IA no WhatsApp dentro de 24 horas, com até 40 mensagens. Se o mesmo lead volta no dia seguinte, conta como outra conversa.",
      "O agente está chegando. Quando a franquia do mês acaba, o lead passa para um corretor e nunca fica sem resposta.",
      `A IA não faz parte do teste grátis: ela começa quando você assina o plano ${PLANS[AI_FIRST_PLAN].name} ou maior.`,
      `${AI_OVERAGE_NOTE}.`,
    ],
  },
  {
    id: "armazenamento",
    question: "Quantos imóveis posso cadastrar com foto?",
    answer: [
      `Cada plano tem um limite de imóveis à venda ou para alugar com fotos hospedadas por nós: de ${SMALLEST_PLAN.limits.owned_listings} no ${SMALLEST_PLAN.name} a ${LARGEST_PLAN.limits.owned_listings} no ${LARGEST_PLAN.name}, com até ${LARGEST_PLAN.limits.photos_per_listing} fotos por imóvel.`,
      `Imóvel marcado como ${OWNED_LISTING_RELEASED_STATUS_TEXT} libera a vaga. Imóvel sem foto não conta, e cliente e condomínio não têm limite.`,
      `${IMPORTED_LISTINGS_NOTE}. ${LISTING_PHOTO_SIZE_NOTE}.`,
    ],
  },
  {
    id: "endereco",
    question: "Qual é o endereço do meu CRM?",
    answer: [
      "Cada imobiliária ganha um endereço exclusivo dentro da nossa plataforma, no ar assim que a conta é criada, com certificado de segurança e sem custo nenhum.",
      "É o mesmo endereço para a equipe usar o CRM e para as landing pages que você publica.",
    ],
  },
  {
    id: "troca",
    question: "Posso trocar de plano depois?",
    answer: [
      "Pode. O upgrade vale na hora, com cobrança proporcional. O downgrade vale no próximo ciclo e nada do que você cadastrou é apagado.",
    ],
  },
  {
    id: "cancelamento",
    question: "Como faço para cancelar?",
    answer: [
      "Direto no app, na tela de assinatura, sem multa. O acesso continua até o fim do período pago, e a exportação de leads, imóveis, clientes e propostas em planilha fica disponível por 90 dias.",
    ],
  },
]

export function PlansFaq() {
  return (
    <Accordion>
      {QUESTIONS.map((item) => (
        <AccordionItem key={item.id} value={item.id}>
          <AccordionTrigger>{item.question}</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">
            {item.answer.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
