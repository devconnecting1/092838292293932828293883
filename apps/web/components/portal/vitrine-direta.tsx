import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { PageHero } from "@/components/portal/content"
import { listarAvulsosPublicos, precoAnuncio, ROTA_FINALIDADE } from "@/lib/portal/avulsos-publicos"

type Filtros = Record<string, string | string[] | undefined>

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "")

/** Vitrine pública de imóveis anunciados pelos donos, para venda ou para aluguel. */
export async function VitrineDireta({
  finalidade,
  filtros,
}: {
  finalidade: "venda" | "aluguel"
  filtros: Filtros
}) {
  const ufRaw = um(filtros.uf)
  const uf = /^[A-Za-z]{2}$/.test(ufRaw) ? ufRaw.toUpperCase() : null
  const cidade = um(filtros.cidade).slice(0, 60) || null
  const quartos = Number(um(filtros.quartos)) || null
  const lista = await listarAvulsosPublicos({ uf, cidade, quartos, finalidade })
  const rota = ROTA_FINALIDADE[finalidade]
  const aluguel = finalidade === "aluguel"
  const campo = "h-11 rounded-lg border border-slate-300 bg-white px-3"

  return (
    <>
      <PageHero
        kicker="Direto com o proprietário"
        title={aluguel ? "Imóveis para alugar" : "Imóveis à venda"}
        text={
          aluguel
            ? "Anunciados pelos próprios donos. Combine a visita direto com quem está alugando e peça o contrato por escrito antes de pagar qualquer valor."
            : "Fora de leilão, anunciados pelos próprios donos. Antes de fechar, peça a matrícula atualizada e as certidões do vendedor."
        }
      >
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/leiloes" className="rounded-full border border-slate-300 bg-white px-4 py-2">
            Arrematar
          </Link>
          <Link
            href="/imoveis-a-venda"
            className={`rounded-full px-4 py-2 ${aluguel ? "border border-slate-300 bg-white" : "bg-[var(--brand)] text-white"}`}
          >
            Comprar
          </Link>
          <Link
            href="/imoveis-para-alugar"
            className={`rounded-full px-4 py-2 ${aluguel ? "bg-[var(--brand)] text-white" : "border border-slate-300 bg-white"}`}
          >
            Alugar
          </Link>
        </div>
        <form className="flex flex-wrap gap-2" action={rota}>
          <select name="uf" defaultValue={uf ?? ""} className={campo}>
            <option value="">Todos os estados</option>
            {BRAZILIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            name="cidade"
            defaultValue={cidade ?? ""}
            placeholder="Cidade"
            className={`${campo} w-44`}
          />
          <select name="quartos" defaultValue={quartos ? String(quartos) : ""} className={campo}>
            <option value="">Quartos</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {q}+ quartos
              </option>
            ))}
          </select>
          <button className="h-11 rounded-lg bg-[var(--brand)] px-5 font-bold text-white">
            Filtrar
          </button>
        </form>
      </PageHero>
      <section className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-10 sm:px-6">
        {lista.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 p-8 text-center">
            <p className="text-lg font-extrabold">Nenhum imóvel aqui ainda.</p>
            <p className="mt-1 text-slate-600">
              Tem um imóvel para {aluguel ? "alugar" : "vender"}?{" "}
              <Link href="/anuncie-gratis" className="font-bold text-[var(--brand)]">
                Anuncie com a gente
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((a) => (
              <Link
                key={a.id}
                href={`${rota}/${a.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-[var(--brand)]"
              >
                {a.fotos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.fotos[0]}
                    alt={a.titulo}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="aspect-[4/3] w-full bg-slate-100" />
                )}
                <div className="flex flex-col gap-1 p-4">
                  <span className="text-xs font-bold tracking-wide text-[var(--brand)] uppercase">
                    {a.tipo} · {[a.bairro, a.cidade].filter(Boolean).join(", ")}/{a.uf}
                  </span>
                  <h2 className="line-clamp-2 font-extrabold group-hover:text-[var(--brand)]">
                    {a.titulo}
                  </h2>
                  <p className="text-xl font-extrabold">{precoAnuncio(a)}</p>
                  {aluguel && (a.valor_condominio || a.valor_iptu) ? (
                    <p className="text-xs text-slate-500">
                      {a.valor_condominio
                        ? `Condomínio ${precoAnuncio({ preco: a.valor_condominio, finalidade: "venda" })}`
                        : ""}
                      {a.valor_condominio && a.valor_iptu ? " · " : ""}
                      {a.valor_iptu
                        ? `IPTU ${precoAnuncio({ preco: a.valor_iptu, finalidade: "venda" })}`
                        : ""}
                    </p>
                  ) : null}
                  <p className="text-sm text-slate-600">
                    {[
                      a.quartos ? `${a.quartos} quarto${a.quartos > 1 ? "s" : ""}` : null,
                      a.vagas ? `${a.vagas} vaga${a.vagas > 1 ? "s" : ""}` : null,
                      a.area ? `${a.area} m²` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["/quanto-vale-meu-imovel", "Quanto vale meu imóvel?"],
              ["/quanto-cobrar-de-aluguel", "Quanto cobrar de aluguel?"],
              ["/anuncie-gratis", "Anunciar para vender ou alugar"],
            ] as [string, string][]
          ).map(([h, t]) => (
            <Link
              key={h}
              href={h}
              className="rounded-2xl border border-slate-200 p-5 font-extrabold hover:border-[var(--brand)]"
            >
              {t} →
            </Link>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Anúncios publicados pelos proprietários, que respondem pelas informações. O Vamos
          Arrematar confere o anúncio antes de publicar, mas não intermedeia essas negociações. Quer
          ajuda para conferir a documentação?{" "}
          <Link href="/suporte" className="font-bold">
            Fale com a gente
          </Link>
          .
        </p>
      </section>
    </>
  )
}
