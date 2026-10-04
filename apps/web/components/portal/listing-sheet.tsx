import { ListingPhoto } from "@/components/portal/listing-photo"
import { brl, dataHora, tipoLabel, usaFotoCaixa, type PortalListing } from "@/lib/portal/imoveis"

/**
 * Ficha completa do imóvel (tela e dossiê em PDF): foto, valores, códigos,
 * leiloeiro, matrícula, processo, datas, áreas e descrição. Campo que a fonte
 * não informa aparece como "Consultar no edital", nunca preenchido por estimativa.
 */
export function ListingSheet({ item, photos }: { item: PortalListing; photos: boolean }) {
  const falta = "Consultar no edital"
  const m2 = (v: number | null) => (v ? `${v.toLocaleString("pt-BR")} m²` : falta)
  const linhas: [string, string][] = [
    ["Origem", item.origemNome],
    ["Modalidade", item.modalidade ?? falta],
    ["Código do imóvel no banco", item.codigoBanco ?? item.numero],
    ["Código do leilão / lote", item.codigoLeilao ?? falta],
    [
      "Leiloeiro",
      item.leiloeiro
        ? `${item.leiloeiro}${item.leiloeiroRegistro ? ` (${item.leiloeiroRegistro})` : ""}`
        : item.modalidade && /venda/i.test(item.modalidade)
          ? "Não há (venda direta)"
          : falta,
    ],
    ["Intermediação", item.intermediador ?? "Não informado"],
    [
      "Matrícula",
      item.matricula ? `${item.matricula}${item.cartorio ? `, ${item.cartorio}` : ""}` : falta,
    ],
    [
      "Processo",
      item.processo ? `${item.processo}${item.vara ? `, ${item.vara}` : ""}` : "Não se aplica",
    ],
    ["1º leilão", dataHora(item.dataLeilao1) ?? "Não informado"],
    ["2º leilão", dataHora(item.dataLeilao2) ?? "Não informado"],
    ["Lance mínimo no 2º leilão", item.lanceLeilao2 ? brl(item.lanceLeilao2) : "Não informado"],
    ["Encerramento", dataHora(item.dataEncerramento) ?? "Não informado"],
    ["Tipo", tipoLabel(item.tipo)],
    ["Área privativa", m2(item.areaPrivativa)],
    ["Área total", m2(item.areaTotal)],
    ["Área do terreno", m2(item.areaTerreno)],
    ["Quartos", item.quartos != null ? String(item.quartos) : falta],
    ["Vagas", item.vagas != null ? String(item.vagas) : falta],
    [
      "Aceita financiamento",
      item.aceitaFinanciamento == null ? falta : item.aceitaFinanciamento ? "Sim" : "Não",
    ],
    ["CEP", item.cep ?? falta],
  ]

  return (
    <section className="grid gap-5 rounded-2xl border border-slate-200 p-4 sm:p-5 md:grid-cols-[minmax(0,320px)_1fr] print:break-inside-avoid">
      <div className="flex flex-col gap-3">
        <ListingPhoto
          numero={item.numero}
          fotos={item.fotos}
          caixa={usaFotoCaixa(item)}
          enabled={photos}
          alt={`Foto do imóvel em ${item.cidade}/${item.uf}`}
          className="h-52 w-full rounded-xl object-cover"
        />
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="block text-xs font-semibold text-slate-500">Valor mínimo</span>
            <span className="text-lg font-extrabold">{brl(item.preco)}</span>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="block text-xs font-semibold text-slate-500">Avaliação</span>
            <span className="text-lg font-extrabold">{brl(item.valorAvaliacao)}</span>
          </div>
        </div>
        {item.desconto ? (
          <span className="self-start rounded-lg bg-[#C2410C] px-2.5 py-1 text-sm font-extrabold text-white">
            {Math.round(item.desconto)}% abaixo da avaliação
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-extrabold">Ficha do imóvel</h2>
        <p className="mt-1 text-sm text-slate-600">
          {[item.endereco, item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(", ")}
        </p>
        <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {linhas.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt className="text-sm text-slate-500">{k}</dt>
              <dd className="text-right text-sm font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        {item.descricao ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            <strong>Descrição: </strong>
            {item.descricao}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
          {item.editalUrl ? (
            <a
              href={item.editalUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-[var(--brand)]"
            >
              Edital: {item.editalUrl.replace(/^https:\/\//, "").slice(0, 60)}
            </a>
          ) : null}
          {item.link && item.link !== item.editalUrl ? (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-[var(--brand)]"
            >
              Página do imóvel na fonte
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}
