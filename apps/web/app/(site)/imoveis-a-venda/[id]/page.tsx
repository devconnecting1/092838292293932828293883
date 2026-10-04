import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  brlInteiro,
  listarAvulsosPublicos,
  precoAnuncio,
  ROTA_FINALIDADE,
  whatsDoDono,
} from "@/lib/portal/avulsos-publicos"
import { siteUrl } from "@/lib/portal/site-url"

export const revalidate = 300

type Props = { params: Promise<{ id: string }> }

async function carregar(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  return (await listarAvulsosPublicos({ id }))[0] ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await carregar((await params).id)
  if (!a) return { title: "Anúncio não encontrado", robots: { index: false } }
  return {
    title: `${a.titulo} · ${a.cidade}/${a.uf}`,
    description: a.descricao.slice(0, 155),
    openGraph: { images: a.fotos.slice(0, 1) },
  }
}

export default async function AvulsoPublicoPage({ params }: Props) {
  const { id } = await params
  const a = await carregar(id)
  if (!a) notFound()
  const rota = ROTA_FINALIDADE[a.finalidade]
  const url = `${siteUrl()}${rota}/${a.id}`
  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href={rota} className="text-sm font-bold text-[var(--brand)]">
        ← {a.finalidade === "aluguel" ? "Todos os imóveis para alugar" : "Todos os imóveis à venda"}
      </Link>
      <div className="grid gap-2 sm:grid-cols-3">
        {a.fotos.slice(0, 9).map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={f}
            src={f}
            alt={`${a.titulo}, foto ${i + 1}`}
            loading={i ? "lazy" : "eager"}
            className={`w-full rounded-xl object-cover ${i === 0 ? "aspect-[4/3] sm:col-span-2 sm:row-span-2 sm:aspect-auto sm:h-full" : "aspect-[4/3]"}`}
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
            {a.tipo} · {[a.bairro, a.cidade].filter(Boolean).join(", ")}/{a.uf}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight">{a.titulo}</h1>
          <p className="text-slate-600">
            {[
              a.quartos ? `${a.quartos} quarto${a.quartos > 1 ? "s" : ""}` : null,
              a.vagas ? `${a.vagas} vaga${a.vagas > 1 ? "s" : ""}` : null,
              a.area ? `${a.area} m²` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="leading-relaxed whitespace-pre-line text-slate-800">{a.descricao}</p>
        </div>
        <aside className="flex h-fit flex-col gap-3 rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-24">
          <p className="text-3xl font-extrabold">{precoAnuncio(a)}</p>
          {a.finalidade === "aluguel" && (a.valor_condominio || a.valor_iptu) ? (
            <p className="text-sm text-slate-600">
              {a.valor_condominio ? `Condomínio ${brlInteiro(a.valor_condominio)}/mês. ` : ""}
              {a.valor_iptu ? `IPTU ${brlInteiro(a.valor_iptu)}/mês.` : ""}
            </p>
          ) : null}
          <p className="text-sm text-slate-600">Anunciado por {a.contato_nome}, proprietário.</p>
          <a
            href={whatsDoDono(a, url)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-[#25D366] px-4 py-3 text-center font-bold text-white"
          >
            Falar com o proprietário no WhatsApp
          </a>
          <p className="text-xs leading-relaxed text-slate-500">
            {a.finalidade === "aluguel"
              ? "Visite o imóvel antes e só pague com contrato de locação assinado."
              : "Antes de pagar qualquer valor, peça a matrícula atualizada do imóvel e as certidões do vendedor."}{" "}
            Quer que a nossa equipe confira para você?{" "}
            <Link href="/suporte" className="font-bold">
              Peça ajuda
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  )
}
