import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { credenciais } from "@/lib/portal/config"
import { lerConfigPortal, pct, reais, type ConfigPortal } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Contrato de parceria do corretor",
  description:
    "Regras da parceria entre o corretor e o Vamos Arrematar: sem mensalidade, comissões e documentos.",
  robots: { index: false },
}

export const revalidate = 300

function clausulas(c: ConfigPortal): [string, string[]][] {
  const r = c.parceria_regras
  const l = c.parceria_leilao
  const a = c.comissao_avulso
  return [
    [
      "1. Partes e objeto",
      [
        `De um lado ${credenciais()} (EMPRESA). De outro, o corretor de imóveis identificado no cadastro do portal, com CRECI ativo (PARCEIRO).`,
        "Objeto: parceria na intermediação de compra e venda de imóveis de leilão e de imóveis anunciados no portal, com divisão de comissão conforme este contrato.",
      ],
    ],
    [
      "2. Sem mensalidade, com atividade",
      [
        "O PARCEIRO aprovado não paga mensalidade e usa as ferramentas do plano Profissional enquanto estiver ativo e com o CRECI regular.",
        `Ativo é quem fecha pelo menos um negócio ou serviço a cada ${r.inatividade_meses} meses. Depois de ${r.inatividade_meses} meses sem fechar nada, a gratuidade é suspensa e o PARCEIRO é convidado a pagar a taxa de administração (${reais(r.taxa_administracao)}) para continuar.`,
        `Cada venda concluída garante mais ${r.bonus_venda_meses} meses de permanência grátis.`,
        `Quem anuncia imóveis por conta própria, sem parceria, paga a taxa de adesão (${reais(r.taxa_adesao)}) e a mensalidade do plano escolhido.`,
      ],
    ],
    [
      "3. Comissão nos imóveis de leilão",
      [
        `Negócio concluído com cliente atendido pelo PARCEIRO corretor, que entrega toda a documentação do cliente: ${pct(l.corretor_com_documentacao)} da comissão recebida pela EMPRESA vão para o PARCEIRO.`,
        `PARCEIRO imobiliária: ${pct(c.parceria_leilao_imobiliaria.imobiliaria)} da comissão recebida pela EMPRESA, com emissão de nota fiscal pela imobiliária.`,
        `Quando a EMPRESA precisar levantar a documentação do cliente: ${pct(l.corretor_sem_documentacao)} para o PARCEIRO.`,
        l.indicacao == null
          ? "Indicação simples, sem atendimento: percentual definido na proposta de cada negócio."
          : `Indicação simples, sem atendimento: ${pct(l.indicacao)} da comissão recebida pela EMPRESA.`,
        "A comissão só é devida com o negócio concluído e a comissão efetivamente recebida pela EMPRESA.",
      ],
    ],
    [
      "4. Imóveis avulsos (anunciados pelo proprietário)",
      [
        `Comissão total de ${pct(a.total)} sobre o valor da venda, paga pelo vendedor conforme a autorização de venda: ${pct(a.corretor)} para o corretor que levou o comprador à visita e fechou o negócio, ${pct(a.plataforma)} para a EMPRESA.`,
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
        `O PARCEIRO aceita o cliente encaminhado em até ${c.rodizio.prazo_minutos} minutos, usa só redes profissionais, não cobra valor do cliente fora do combinado e responde tecnicamente pelas intermediações que fizer, sob o seu CRECI.`,
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
}

export default async function ParceriaCorretorPage() {
  const cfg = await lerConfigPortal()
  const CLAUSULAS = clausulas(cfg)
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
        <p className="text-xs text-slate-500">Versão {cfg.termo_indicacao.versao}.</p>
      </Section>
    </>
  )
}
