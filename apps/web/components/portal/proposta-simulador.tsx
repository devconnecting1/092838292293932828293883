"use client"

import * as React from "react"
import Link from "next/link"

/**
 * Tutorial interativo de proposta de compra de imóvel retomado, com uma
 * pessoa e um imóvel FICTÍCIOS. Nada aqui é enviado a lugar nenhum: serve
 * para o cliente ver, passo a passo, como é a proposta antes de fazer a dele.
 * A imobiliária que aparece como intermediadora é a do portal.
 */

const AZUL_CAIXA = "#005CA9"
const LARANJA_CAIXA = "#F39200"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })

const IMOVEL = {
  titulo: "Apartamento 2 quartos",
  bairro: "Centro",
  cidade: "Nova Iguaçu",
  uf: "RJ",
  endereco: "Rua Exemplo, 100, apto 101, bloco A, Centro, Nova Iguaçu/RJ, CEP 26000-000",
  numero: "0000000000001",
  matricula: "00000",
  cartorio: "Registro de Imóveis da comarca (exemplo)",
  inscricao: "000000000000",
  area: 52,
  quartos: 2,
  vagas: 1,
  avaliacao: 210000,
  minimo: 126000,
  modalidade: "Venda Online",
  financiamento: true,
  fgts: false,
}

const PESSOA = {
  nome: "Maria Exemplo da Silva",
  cpf: "000.000.000-00",
  nascimento: "15/03/1988",
  estadoCivil: "Solteira",
  profissao: "Professora",
  renda: 9500,
  email: "maria.exemplo@exemplo.com.br",
  telefone: "(21) 90000-0000",
  endereco: "Rua Fictícia, 50, Centro, Nova Iguaçu/RJ",
}

const PASSOS = [
  "Imóvel",
  "Meus dados",
  "Imóvel selecionado",
  "Proponente",
  "Imobiliária",
  "Pagamento",
  "Assessoria",
  "Declaração",
  "Proposta",
]

const DECLARACOES = [
  "Li o edital e as regras da venda deste imóvel.",
  "Sei que o imóvel pode estar ocupado e que a desocupação é por minha conta.",
  "Sei quais despesas ficam comigo, como ITBI, registro e dívidas previstas no edital.",
  "Conferi a matrícula e a situação do imóvel antes de fazer a proposta.",
]

type Empresa = { nome: string; cnpj: string; creci: string; endereco: string; corretor: string }

function Linha({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-slate-100 py-2 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-bold text-slate-900">{v}</span>
    </div>
  )
}

function Ficticio() {
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
      Dados fictícios
    </span>
  )
}

export function PropostaSimulador({ empresa }: { empresa: Empresa }) {
  const [passo, setPasso] = React.useState(0)
  const [valor, setValor] = React.useState(IMOVEL.minimo)
  const [forma, setForma] = React.useState<"avista" | "financiamento">("financiamento")
  const [entradaPct, setEntradaPct] = React.useState(20)
  const [assessoria, setAssessoria] = React.useState(true)
  const [marcadas, setMarcadas] = React.useState<boolean[]>(DECLARACOES.map(() => true))

  const entrada = Math.round((valor * entradaPct) / 100)
  const financiado = valor - entrada
  const prazo = 420
  const taxaMes = Math.pow(1 + 0.115, 1 / 12) - 1
  const primeiraSac = financiado / prazo + financiado * taxaMes
  const rendaMin = primeiraSac / 0.3
  const itbi = valor * 0.03
  const cartorio = IMOVEL.avaliacao * 0.03
  const desconto = Math.round((1 - valor / IMOVEL.avaliacao) * 100)
  const valorTexto = valor.toLocaleString("pt-BR")
  const podeAvancar = passo !== 7 || marcadas.every(Boolean)

  function ir(p: number) {
    setPasso(Math.max(0, Math.min(PASSOS.length - 1, p)))
    document.getElementById("simulador-topo")?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div id="simulador-topo" className="flex scroll-mt-24 flex-col gap-5">
      <ol className="flex gap-1.5 overflow-x-auto pb-1 print:hidden">
        {PASSOS.map((t, i) => (
          <li key={t} className="shrink-0">
            <button
              type="button"
              onClick={() => ir(i)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                i === passo
                  ? "border-transparent text-white"
                  : i < passo
                    ? "border-slate-300 bg-white text-slate-800"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
              style={i === passo ? { background: AZUL_CAIXA } : undefined}
            >
              <span
                className="grid size-5 place-items-center rounded-full text-[11px] text-white"
                style={{ background: i <= passo ? LARANJA_CAIXA : "#CBD5E1" }}
              >
                {i + 1}
              </span>
              {t}
            </button>
          </li>
        ))}
      </ol>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          className="h-1.5"
          style={{ background: `linear-gradient(90deg, ${AZUL_CAIXA} 70%, ${LARANJA_CAIXA} 70%)` }}
        />
        <div className="flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-extrabold" style={{ color: AZUL_CAIXA }}>
              {passo + 1}. {PASSOS[passo]}
            </h2>
            <Ficticio />
          </div>

          {passo === 0 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-lg font-extrabold">
                  {IMOVEL.titulo} em {IMOVEL.bairro}, {IMOVEL.cidade}/{IMOVEL.uf}
                </p>
                <p className="mt-1 text-sm text-slate-600">{IMOVEL.endereco}</p>
                <div className="mt-4 rounded-xl p-4" style={{ background: "#EEF5FB" }}>
                  <span className="text-sm text-slate-600">Valor mínimo de venda</span>
                  <p className="text-3xl font-extrabold" style={{ color: AZUL_CAIXA }}>
                    {brl(IMOVEL.minimo)}
                  </p>
                  <span className="text-sm text-slate-600">
                    Avaliação {brl(IMOVEL.avaliacao)} · desconto de{" "}
                    {Math.round((1 - IMOVEL.minimo / IMOVEL.avaliacao) * 100)}%
                  </span>
                </div>
                <ul className="mt-4 flex flex-col gap-1 text-sm">
                  <li>
                    {IMOVEL.financiamento ? "Aceita" : "Não aceita"} financiamento habitacional.
                  </li>
                  <li>{IMOVEL.fgts ? "Aceita" : "Não aceita"} uso do FGTS.</li>
                  <li>Não aceita parcelamento nem consórcio.</li>
                </ul>
              </div>
              <div>
                <Linha k="Modalidade" v={IMOVEL.modalidade} />
                <Linha k="Número do imóvel" v={IMOVEL.numero} />
                <Linha k="Matrícula" v={IMOVEL.matricula} />
                <Linha k="Cartório" v={IMOVEL.cartorio} />
                <Linha k="Inscrição imobiliária" v={IMOVEL.inscricao} />
                <Linha k="Área privativa" v={`${IMOVEL.area} m²`} />
                <Linha k="Quartos / vagas" v={`${IMOVEL.quartos} / ${IMOVEL.vagas}`} />
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Antes de qualquer proposta, leia a matrícula e as regras da venda. É nelas que
                  estão as dívidas, a ocupação e quem paga cada despesa.
                </p>
              </div>
            </div>
          ) : null}

          {passo === 1 ? (
            <div className="flex flex-col gap-3">
              <p className="leading-relaxed text-slate-700">
                Primeiro, quem vai comprar entra com os próprios dados de acesso no sistema de
                vendas. Aqui usamos uma pessoa de exemplo.
              </p>
              <div className="grid gap-x-8 md:grid-cols-2">
                <Linha k="Nome" v={PESSOA.nome} />
                <Linha k="CPF" v={PESSOA.cpf} />
                <Linha k="E-mail" v={PESSOA.email} />
                <Linha k="Telefone" v={PESSOA.telefone} />
              </div>
            </div>
          ) : null}

          {passo === 2 ? (
            <div className="flex flex-col gap-3">
              <p className="leading-relaxed text-slate-700">
                Confira se o número do imóvel é o mesmo que você escolheu. Errar aqui é proposta no
                imóvel errado.
              </p>
              <Linha k="Número do imóvel" v={IMOVEL.numero} />
              <Linha k="Endereço" v={IMOVEL.endereco} />
              <Linha k="Valor mínimo" v={brl(IMOVEL.minimo)} />
              <label className="mt-2 flex flex-col gap-1 text-sm font-bold">
                Valor da proposta
                <input
                  inputMode="numeric"
                  value={valorTexto}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ""))
                    setValor(Number.isFinite(n) ? n : 0)
                  }}
                  className="h-12 rounded-lg border border-slate-300 px-3 text-lg font-extrabold"
                />
              </label>
              {valor < IMOVEL.minimo ? (
                <p className="text-sm font-bold text-red-700">
                  A proposta não pode ser menor que o valor mínimo de venda.
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  {desconto > 0 ? `${desconto}% abaixo da avaliação.` : "Acima da avaliação."}
                </p>
              )}
            </div>
          ) : null}

          {passo === 3 ? (
            <div className="grid gap-x-8 md:grid-cols-2">
              <Linha k="Nome completo" v={PESSOA.nome} />
              <Linha k="CPF" v={PESSOA.cpf} />
              <Linha k="Data de nascimento" v={PESSOA.nascimento} />
              <Linha k="Estado civil" v={PESSOA.estadoCivil} />
              <Linha k="Profissão" v={PESSOA.profissao} />
              <Linha k="Renda mensal" v={brl(PESSOA.renda)} />
              <Linha k="Endereço" v={PESSOA.endereco} />
              <Linha k="Telefone" v={PESSOA.telefone} />
              <p className="mt-3 text-sm leading-relaxed text-slate-600 md:col-span-2">
                Se for casado, os dados do cônjuge também entram aqui, conforme o regime de bens.
              </p>
            </div>
          ) : null}

          {passo === 4 ? (
            <div className="flex flex-col gap-3">
              <p className="leading-relaxed text-slate-700">
                Neste passo entra a imobiliária que vai acompanhar a compra. Na sua proposta de
                verdade, você escolhe a nossa:
              </p>
              <div
                className="rounded-xl border-2 p-4"
                style={{ borderColor: AZUL_CAIXA, background: "#EEF5FB" }}
              >
                <Linha k="Imobiliária" v={empresa.nome} />
                <Linha k="CNPJ" v={empresa.cnpj} />
                <Linha k="CRECI" v={empresa.creci} />
                <Linha k="Corretor responsável" v={empresa.corretor} />
                <Linha k="Endereço" v={empresa.endereco} />
              </div>
            </div>
          ) : null}

          {passo === 5 ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["financiamento", "Com financiamento"],
                    ["avista", "À vista"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setForma(v)}
                    className={`rounded-lg border px-3 py-3 text-sm font-bold ${forma === v ? "text-white" : "border-slate-300"}`}
                    style={
                      forma === v ? { background: AZUL_CAIXA, borderColor: AZUL_CAIXA } : undefined
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
              {forma === "financiamento" ? (
                <>
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    Entrada: {entradaPct}% ({brl(entrada)})
                    <input
                      type="range"
                      min={5}
                      max={80}
                      step={5}
                      value={entradaPct}
                      onChange={(e) => setEntradaPct(Number(e.target.value))}
                      style={{ accentColor: LARANJA_CAIXA }}
                    />
                  </label>
                  <Linha k="Valor financiado" v={brl(financiado)} />
                  <Linha k="Prazo" v={`${prazo} meses`} />
                  <Linha k="Sistema" v="SAC (parcela começa maior e cai)" />
                  <Linha k="Primeira parcela estimada" v={brl(primeiraSac)} />
                  <Linha k="Renda mínima estimada (30%)" v={brl(rendaMin)} />
                  <p
                    className={`rounded-lg p-3 text-sm font-bold ${PESSOA.renda >= rendaMin ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
                  >
                    {PESSOA.renda >= rendaMin
                      ? `A renda de ${brl(PESSOA.renda)} cabe nesta simulação.`
                      : `A renda de ${brl(PESSOA.renda)} não cabe. Aumente a entrada.`}
                  </p>
                  <p className="text-xs text-slate-500">
                    Taxa de referência de 11,5% ao ano, só para o exemplo. A aprovação depende da
                    análise de crédito do banco.
                  </p>
                </>
              ) : (
                <>
                  <Linha k="Pagamento" v={brl(valor)} />
                  <p className="text-sm text-slate-600">
                    No pagamento à vista, o valor é pago pelo boleto emitido depois que a proposta é
                    aceita, dentro do prazo das regras da venda.
                  </p>
                </>
              )}
              <div className="rounded-xl bg-slate-50 p-4">
                <span className="text-sm font-extrabold">Despesas que vêm junto</span>
                <Linha k="ITBI (3% do valor, varia por cidade)" v={brl(itbi)} />
                <Linha k="Registro e escritura (estimativa)" v={brl(cartorio)} />
              </div>
            </div>
          ) : null}

          {passo === 6 ? (
            <div className="flex flex-col gap-3">
              <p className="leading-relaxed text-slate-700">
                Com a assessoria, você não fica sozinho depois da proposta. Cuidamos da análise, dos
                documentos, da negociação com quem estiver no imóvel e do registro, até a chave na
                sua mão.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setAssessoria(v)}
                    className={`rounded-lg border px-3 py-3 text-sm font-bold ${assessoria === v ? "text-white" : "border-slate-300"}`}
                    style={
                      assessoria === v
                        ? { background: AZUL_CAIXA, borderColor: AZUL_CAIXA }
                        : undefined
                    }
                  >
                    {v ? "Quero assessoria" : "Vou sozinho"}
                  </button>
                ))}
              </div>
              {assessoria ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  <li>Análise do edital, da matrícula e das dívidas antes do lance.</li>
                  <li>Negociação extrajudicial com o ocupante, já incluída.</li>
                  <li>Acompanhamento de pagamento, ITBI, escritura e registro.</li>
                </ul>
              ) : (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  Sem assessoria, cada etapa fica por sua conta, inclusive a desocupação.
                </p>
              )}
            </div>
          ) : null}

          {passo === 7 ? (
            <div className="flex flex-col gap-2">
              <p className="leading-relaxed text-slate-700">
                Antes de enviar, a pessoa confirma que conhece as regras. Na proposta real, leia
                cada declaração com calma.
              </p>
              {DECLARACOES.map((d, i) => (
                <label key={d} className="block rounded-lg border border-slate-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={marcadas[i]}
                    onChange={(e) =>
                      setMarcadas((m) => m.map((x, j) => (j === i ? e.target.checked : x)))
                    }
                    className="mr-2 inline size-4 align-[-3px]"
                    style={{ accentColor: AZUL_CAIXA }}
                  />
                  {d}
                </label>
              ))}
            </div>
          ) : null}

          {passo === 8 ? (
            <div className="relative flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 p-5">
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-5xl font-extrabold text-slate-200 select-none sm:text-7xl">
                SIMULAÇÃO
              </span>
              <div className="relative flex flex-col gap-1">
                <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                  Resumo da proposta (exemplo sem validade)
                </span>
                <Linha k="Imóvel" v={`${IMOVEL.numero} · ${IMOVEL.cidade}/${IMOVEL.uf}`} />
                <Linha k="Proponente" v={`${PESSOA.nome} · CPF ${PESSOA.cpf}`} />
                <Linha k="Valor da proposta" v={brl(valor)} />
                <Linha
                  k="Pagamento"
                  v={
                    forma === "avista"
                      ? "À vista"
                      : `Financiamento: entrada ${brl(entrada)} + ${brl(financiado)} em ${prazo} meses`
                  }
                />
                <Linha k="Imobiliária" v={`${empresa.nome} · ${empresa.creci}`} />
                <Linha k="Assessoria" v={assessoria ? "Sim, até a entrega da chave" : "Não"} />
                <Linha
                  k="Declarações"
                  v={`${marcadas.filter(Boolean).length} de ${DECLARACOES.length} confirmadas`}
                />
              </div>
              <div className="relative flex flex-wrap gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold"
                >
                  Imprimir exemplo
                </button>
                <Link
                  href="/como-funciona/caixa#assessoria"
                  className="rounded-lg px-4 py-2.5 text-sm font-bold text-white"
                  style={{ background: LARANJA_CAIXA }}
                >
                  Fazer a minha proposta com assessoria
                </Link>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 print:hidden">
            <button
              type="button"
              onClick={() => ir(passo - 1)}
              disabled={passo === 0}
              className="rounded-lg px-4 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-30"
            >
              Voltar
            </button>
            {passo < PASSOS.length - 1 ? (
              <button
                type="button"
                onClick={() => ir(passo + 1)}
                disabled={!podeAvancar || (passo === 2 && valor < IMOVEL.minimo)}
                className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                style={{ background: AZUL_CAIXA }}
              >
                {passo === 0 ? "Fazer uma proposta" : "Avançar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => ir(0)}
                className="rounded-lg px-6 py-2.5 text-sm font-bold"
                style={{ color: AZUL_CAIXA }}
              >
                Recomeçar
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Simulação para aprender, com pessoa e imóvel fictícios. Não é o sistema da Caixa, nada é
        enviado e nenhuma proposta é feita por aqui. As regras de cada venda estão no edital do
        imóvel.
      </p>
    </div>
  )
}
