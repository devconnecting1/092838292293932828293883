import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { credenciais } from "@/lib/portal/config"
import { AUTORIZACAO_VERSAO } from "@/lib/portal/avulsos"
import { lerConfigPortal, pct } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Autorização de venda e termo de privacidade do anúncio grátis",
  robots: { index: false },
}

export const revalidate = 300

export default async function AutorizacaoPage() {
  const a = (await lerConfigPortal()).comissao_avulso
  const itens = [
    `O PROPRIETÁRIO autoriza ${credenciais()} e os corretores parceiros cadastrados no portal a divulgar e a apresentar o imóvel anunciado a interessados, sem exclusividade.`,
    "O anúncio é grátis. Se o PROPRIETÁRIO vender diretamente a quem o procurou sem corretor, não há comissão.",
    `Se a venda acontecer com comprador apresentado por corretor parceiro (visita ou contato registrado no sistema), o PROPRIETÁRIO paga comissão de ${pct(a.total)} sobre o valor da venda: ${pct(a.corretor)} ao corretor e ${pct(a.plataforma)} à empresa. Vale o percentual em vigor na data do aceite, que fica gravado no anúncio.`,
    "O PROPRIETÁRIO declara ser dono do imóvel ou ter poderes para vendê-lo e que as informações e fotos são verdadeiras.",
    "O anúncio, o endereço e o telefone do PROPRIETÁRIO ficam visíveis só para os corretores parceiros aprovados e para a empresa, que fazem a divulgação aos seus clientes.",
    "Os dados pessoais são usados só para a divulgação e a intermediação deste imóvel, guardados com segurança e apagados a pedido, conforme a Lei Geral de Proteção de Dados. O PROPRIETÁRIO pode pedir acesso, correção ou exclusão pelo 0800 543 1000.",
    "O PROPRIETÁRIO pode pausar ou encerrar o anúncio a qualquer momento pelo painel. Negociações já iniciadas por corretor continuam com a comissão combinada.",
    "O aceite digital registra data, hora e versão deste termo.",
  ]
  return (
    <>
      <PageHero kicker="Anúncio grátis" title="Autorização de venda e privacidade" />
      <Section title="Termos">
        <ol className="flex list-decimal flex-col gap-2 pl-5 leading-relaxed text-slate-700">
          {itens.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">Versão {AUTORIZACAO_VERSAO}.</p>
      </Section>
    </>
  )
}
