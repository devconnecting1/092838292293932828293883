import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { credenciais } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Termo de indicação de cliente",
  robots: { index: false },
}

export default function TermoIndicacaoPage() {
  const itens = [
    `O cliente encaminhado pela central do portal é indicação de ${credenciais()} (EMPRESA). Ao aceitar este termo, o PARCEIRO (corretor ou imobiliária) reconhece que o cliente chegou pela EMPRESA.`,
    "O PARCEIRO atende o cliente com cuidado e registra no sistema cada etapa: contato, visita, proposta, venda ou desistência. Sem retorno, a EMPRESA pode retirar o cliente e encaminhá-lo a outro parceiro.",
    "O PARCEIRO não negocia com esse cliente por fora da plataforma, nem direta nem indiretamente, enquanto durar o atendimento e por 12 meses depois do último contato registrado, para qualquer imóvel apresentado nesse período.",
    "Comissão nos negócios com cliente indicado: corretor parceiro, 40% da comissão recebida pela EMPRESA; imobiliária parceira, 50%, emitindo nota fiscal. A divisão só é devida com o negócio concluído e a comissão recebida.",
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
        <p className="text-xs text-slate-500">Versão 2026-10-v1.</p>
      </Section>
    </>
  )
}
