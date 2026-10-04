import type { Metadata } from "next"

import { CtaBand, PageHero, Section } from "@/components/portal/content"
import { whatsappHref } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Corretor: sua página grátis com todos os leilões",
  description:
    "Corretor com CRECI ganha página grátis com o próprio nome, todos os leilões, Selo Verde e parceria 50/50.",
}

const CTA = whatsappHref("Olá! Sou corretor e quero a minha página grátis no portal.")

export default function CorretoresPage() {
  return (
    <>
      <PageHero
        kicker="Para corretores com CRECI"
        title="Sua página grátis, com o seu nome e todos os leilões."
        text="Sem mensalidade. Você divulga o seu link, o cliente vê os leilões com a sua foto e o seu WhatsApp, e a assessoria cuida da parte técnica."
      >
        <a
          href={CTA}
          className="mt-2 self-start rounded-xl bg-[var(--brand)] px-6 py-4 font-extrabold text-white"
        >
          Quero minha página
        </a>
      </PageHero>
      <Section title="O que você ganha">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [
              "Página com o seu nome",
              "Endereço próprio (seunome.vamosarrematar.com.br), foto ou logomarca, CRECI e WhatsApp.",
            ],
            ["Todos os leilões", "A lista da Caixa em todo o Brasil, atualizada, na sua página."],
            [
              "Calculadora de viabilidade",
              "Estudo completo de custos e retorno para enviar ao cliente.",
            ],
            [
              "Serviços que geram renda",
              "Vistoria, avaliação, diligência e desocupação amigável, com o seu preço.",
            ],
            ["Seu estoque", "Anuncie imóveis para revenda e locação."],
            ["Painel e contatos", "Os pedidos dos clientes chegam direto para você."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-slate-200 p-5">
              <span className="font-extrabold">{t}</span>
              <p className="mt-1 leading-relaxed text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section id="selo-verde" title="Selo Verde: só entra quem está regular" muted>
        <p className="leading-relaxed text-slate-700">
          Para receber o Selo Verde e entrar no portal, o corretor envia:
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            "CRECI ativo, com foto da carteira",
            "Certidão criminal da Justiça Estadual",
            "Certidão criminal da Justiça Federal",
            "Comprovante de residência de até 90 dias",
          ].map((i) => (
            <li key={i} className="rounded-xl border border-slate-200 bg-white p-4 font-semibold">
              {i}
            </li>
          ))}
        </ul>
        <p className="text-sm leading-relaxed text-slate-500">
          O selo indica que os documentos foram conferidos na data informada e é renovado
          periodicamente. Ele não é garantia da atuação do corretor.
        </p>
      </Section>
      <Section id="parceria" title="Como anunciar">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--brand-soft)] p-6">
            <span className="text-xs font-extrabold tracking-wider text-[var(--brand)] uppercase">
              Recomendado
            </span>
            <h3 className="mt-1 text-xl font-extrabold">Parceria 50/50</h3>
            <p className="mt-2 leading-relaxed text-slate-700">
              Sem custo. Nós fazemos o marketing do imóvel no portal, nos portais imobiliários e nas
              redes sociais. Na venda, a comissão é dividida meio a meio.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 p-6">
            <span className="text-xs font-extrabold tracking-wider text-slate-500 uppercase">
              Comissão 100% sua
            </span>
            <h3 className="mt-1 text-xl font-extrabold">Pacote de anúncio</h3>
            <p className="mt-2 leading-relaxed text-slate-700">
              Você paga a publicidade e fica com toda a comissão. Vale para leilão, venda avulsa e
              locação.
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-500">
          Este é o portal do corretor: anúncios e atendimento são de responsabilidade do corretor
          anunciante, sob o seu CRECI. Nos negócios em parceria, a responsabilidade segue o contrato
          de parceria.
        </p>
      </Section>
      <CtaBand
        title="Comece hoje, de graça"
        text="Envie seus dados e documentos pelo WhatsApp e receba o acesso após a aprovação."
        href={CTA}
        label="Quero minha página"
      />
    </>
  )
}
