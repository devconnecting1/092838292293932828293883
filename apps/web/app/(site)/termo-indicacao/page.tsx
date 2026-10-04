import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { credenciais } from "@/lib/portal/config"
import { lerConfigPortal, pct } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Termo de indicação de cliente",
  robots: { index: false },
}

export const revalidate = 300

export default async function TermoIndicacaoPage() {
  const c = await lerConfigPortal()
  const meses = c.termo_indicacao.nao_aliciamento_meses ?? 12
  const itens = [
    `O cliente encaminhado pela central do portal é indicação de ${credenciais()} (EMPRESA). Ao aceitar este termo, o PARCEIRO (corretor ou imobiliária) reconhece que o cliente chegou pela EMPRESA.`,
    "O PARCEIRO atende o cliente com cuidado e registra no sistema cada etapa: contato, visita, proposta, venda ou desistência. Sem retorno, a EMPRESA pode retirar o cliente e encaminhá-lo a outro parceiro.",
    `O PARCEIRO não negocia com esse cliente por fora da plataforma, nem direta nem indiretamente, enquanto durar o atendimento e por ${meses} meses depois do último contato registrado, para qualquer imóvel apresentado nesse período.`,
    `Comissão nos negócios com cliente indicado: corretor parceiro, ${pct(c.parceria_leilao.corretor_com_documentacao)} da comissão recebida pela EMPRESA; imobiliária parceira, ${pct(c.parceria_leilao_imobiliaria.imobiliaria)}, emitindo nota fiscal. A divisão só é devida com o negócio concluído e a comissão recebida.`,
    "Se o PARCEIRO concluir negócio com o cliente indicado sem informar a EMPRESA, responde pela comissão que caberia à EMPRESA e pelas perdas e danos, inclusive danos morais, além de perder o acesso ao portal.",
    "Os dados do cliente só podem ser usados para este atendimento, com sigilo, conforme a Lei Geral de Proteção de Dados.",
    "O aceite é eletrônico e fica registrado com data, hora, versão deste termo e o usuário que aceitou.",
  ]
  return (
    <>
      <PageHero
        kicker="Parceiros"
        title="Termo de indicação de cliente"
        text="Este termo vale para todo cliente que a central do portal encaminhar a um corretor ou imobiliária parceira."
      />
      <Section title="Cláusulas">
        <ol className="flex list-decimal flex-col gap-2 pl-5 leading-relaxed text-slate-700">
          {itens.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">Versão {c.termo_indicacao.versao}.</p>
      </Section>
    </>
  )
}
