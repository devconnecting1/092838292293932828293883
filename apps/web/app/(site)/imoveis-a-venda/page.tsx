import type { Metadata } from "next"
import Link from "next/link"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"

import { PageHero } from "@/components/portal/content"
import { brlInteiro, listarAvulsosPublicos } from "@/lib/portal/avulsos-publicos"

export const metadata: Metadata = {
  title: "Imóveis à venda direto com o proprietário",
  description:
    "Casas, apartamentos e terrenos anunciados pelos próprios donos no Vamos Arrematar. Fale direto com o proprietário.",
}

export const revalidate = 300

type Params = Promise<Record<string, string | string[] | undefined>>

export default async function ImoveisAVendaPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams
  const uf = typeof sp.uf === "string" && /^[A-Za-z]{2}$/.test(sp.uf) ? sp.uf.toUpperCase() : null
  const lista = await listarAvulsosPublicos({ uf })
  return (
    <>
      <PageHero
        kicker="Direto com o proprietário"
        title="Imóveis à venda anunciados pelos donos"
        text="Fora de leilão, sem intermediação: você conversa direto com quem está vendendo. Antes de fechar, peça a matrícula atualizada e as certidões do vendedor."
      >
        <form className="flex flex-wrap gap-2" action="/imoveis-a-venda">
          <select
            name="uf"
            defaultValue={uf ?? ""}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3"
          >
            <option value="">Todos os estados</option>
            {BRAZILIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
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
            <p className="text-lg font-extrabold">Nenhum imóvel anunciado aqui ainda.</p>
            <p className="mt-1 text-slate-600">
              Tem um imóvel para vender?{" "}
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
                href={`/imoveis-a-venda/${a.id}`}
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
                  <p className="text-xl font-extrabold">{brlInteiro(a.preco)}</p>
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
        <p className="text-xs text-slate-500">
          Anúncios publicados pelos proprietários, que respondem pelas informações. O Vamos
          Arrematar confere o anúncio antes de publicar, mas não intermedeia essas vendas. Quer
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
