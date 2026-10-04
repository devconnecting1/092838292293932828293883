import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Contrato de parceria do corretor",
  description:
    "Regras da parceria entre o corretor e o Vamos Arrematar: sem mensalidade, comissões e documentos.",
  robots: { index: false },
}

const CLAUSULAS: [string, string[]][] = [
  [
    "1. Partes e objeto",
    [
      `De um lado ${PORTAL.legalName}, CNPJ ${PORTAL.cnpj}, ${PORTAL.creci} (EMPRESA). De outro, o corretor de imóveis identificado no cadastro do portal, com CRECI ativo (PARCEIRO).`,
      "Objeto: parceria na intermediação de compra e venda de imóveis de leilão e de imóveis anunciados no portal, com divisão de comissão conforme este contrato.",
    ],
  ],
  [
    "2. Sem mensalidade",
    [
      "O PARCEIRO aprovado não paga mensalidade e usa as ferramentas do plano Profissional enquanto o contrato estiver ativo e o CRECI regular.",
    ],
  ],
  [
    "3. Comissão nos imóveis de leilão",
    [
      "Negócio concluído com cliente trazido e atendido pelo PARCEIRO, que entrega toda a documentação do cliente: 40% da comissão recebida pela EMPRESA vão para o PARCEIRO.",
      "Quando a EMPRESA precisar levantar a documentação do cliente: 20% para o PARCEIRO.",
      "Indicação simples, sem atendimento: percentual definido na proposta de cada negócio.",
      "A comissão só é devida com o negócio concluído e a comissão efetivamente recebida pela EMPRESA.",
    ],
  ],
  [
    "4. Imóveis avulsos (anunciados pelo proprietário)",
    [
      "Comissão total de 6% sobre o valor da venda, paga pelo vendedor conforme a autorização de venda: 4% para o corretor que levou o comprador à visita e fechou o negócio, 2% para a EMPRESA.",
    ],
  ],
  [
    "5. Cadastro e documentos",
    [
      "O PARCEIRO mantém atualizados: foto profissional, CRECI frente e verso, print do cadastro ativo no site do CRECI, certidão de regularidade, comprovante de residência, dois telefones de recado, chave PIX ou conta bancária e redes sociais profissionais.",
      "CRECI suspenso, cancelado ou irregular suspende a parceria na hora.",
    ],
  ],
  [
    "6. Conduta",
    [
      "O PARCEIRO atende o cliente em até 30 minutos pelo rodízio de leads, usa só redes profissionais, não cobra valor do cliente fora do combinado e responde tecnicamente pelas intermediações que fizer, sob o seu CRECI.",
    ],
  ],
  [
    "7. Dados pessoais",
    [
      "As partes tratam os dados de clientes só para a intermediação, com sigilo, e não os usam para outra finalidade nem os repassam a terceiros, conforme a Lei Geral de Proteção de Dados.",
    ],
  ],
  [
    "8. Prazo e encerramento",
    [
      "Prazo indeterminado. Qualquer parte pode encerrar com aviso pelo painel ou por e-mail. Negócios em andamento seguem com a divisão já combinada.",
    ],
  ],
]

export default function ParceriaCorretorPage() {
  return (
    <>
      <PageHero
        kicker="Contrato de parceria"
        title="Parceria do corretor com o Vamos Arrematar"
        text="Aceito no painel, com registro de data e hora. Guarde uma cópia."
      />
      <Section title="Cláusulas">
        {CLAUSULAS.map(([t, ps]) => (
          <div key={t} className="flex flex-col gap-2">
            <h3 className="font-extrabold">{t}</h3>
            {ps.map((p) => (
              <p key={p} className="leading-relaxed text-slate-700">
                {p}
              </p>
            ))}
          </div>
        ))}
        <p className="text-xs text-slate-500">Versão 2026-10-v1.</p>
      </Section>
    </>
  )
}
