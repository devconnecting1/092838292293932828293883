"use client"

import * as React from "react"

import { portalBrowserClient } from "@/lib/portal/browser-client"

/**
 * Kit de anúncio do corretor: gera, no próprio navegador, a arte do feed
 * (1080x1080) e do stories (1080x1920), a legenda e os botões de compartilhar.
 *
 * A arte não usa a foto do banco ou do leiloeiro (direito de imagem de
 * terceiro e bloqueio de cópia do servidor deles). Entra a foto ou logo do
 * próprio corretor, enviada do aparelho dele, e o anúncio leva o link da
 * página do imóvel, onde as fotos aparecem por referência.
 */

export type KitImovel = {
  titulo: string
  local: string
  preco: string
  avaliacao: string | null
  desconto: number | null
  origem: string
  modalidade: string | null
  codigo: string
  url: string
  financiamento: boolean | null
}

type Corretor = { nome: string; creci: string; whatsapp: string; foto: string | null }

const FORMATOS = {
  feed: { w: 1080, h: 1080, nome: "Feed (1080 x 1080)" },
  stories: { w: 1080, h: 1920, nome: "Stories (1080 x 1920)" },
} as const

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ")
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = w
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

async function desenhar(
  canvas: HTMLCanvasElement,
  formato: keyof typeof FORMATOS,
  im: KitImovel,
  c: Corretor,
  cor: string,
  marca: string,
  fotoImovel: string | null
) {
  const { w, h } = FORMATOS[formato]
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  const story = formato === "stories"
  const pad = 80

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  const faixa = story ? 760 : 470
  ctx.fillStyle = cor
  ctx.fillRect(0, 0, w, faixa)
  if (fotoImovel) {
    const img = new Image()
    img.src = fotoImovel
    await img.decode().catch(() => undefined)
    if (img.naturalWidth) {
      const r = Math.max(w / img.naturalWidth, faixa / img.naturalHeight)
      const iw = img.naturalWidth * r
      const ih = img.naturalHeight * r
      ctx.drawImage(img, (w - iw) / 2, (faixa - ih) / 2, iw, ih)
      const g = ctx.createLinearGradient(0, 0, 0, faixa)
      g.addColorStop(0, "rgba(15,23,42,0.55)")
      g.addColorStop(1, "rgba(15,23,42,0.25)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, faixa)
    }
  }

  ctx.fillStyle = "#ffffff"
  ctx.font = "800 44px system-ui, sans-serif"
  ctx.fillText(
    [im.origem, im.modalidade].filter(Boolean).join(" · ").toUpperCase(),
    pad,
    story ? 200 : 120
  )

  let y = story ? 330 : 220
  if (im.desconto) {
    ctx.font = `900 ${story ? 190 : 150}px system-ui, sans-serif`
    ctx.fillText(`${Math.round(im.desconto)}% OFF`, pad - 6, y + (story ? 130 : 100))
    y += story ? 230 : 180
    ctx.font = "600 40px system-ui, sans-serif"
    ctx.fillText("abaixo da avaliação", pad, y)
  }

  y = story ? 860 : 560
  ctx.fillStyle = "#0f172a"
  ctx.font = "800 64px system-ui, sans-serif"
  for (const l of wrap(ctx, im.titulo, w - pad * 2).slice(0, 2)) {
    ctx.fillText(l, pad, y)
    y += 76
  }
  ctx.fillStyle = "#475569"
  ctx.font = "500 40px system-ui, sans-serif"
  for (const l of wrap(ctx, im.local, w - pad * 2).slice(0, 2)) {
    ctx.fillText(l, pad, y)
    y += 52
  }
  y += 30
  ctx.fillStyle = "#0f172a"
  ctx.font = "900 92px system-ui, sans-serif"
  ctx.fillText(im.preco, pad, y + 70)
  y += 110
  if (im.avaliacao) {
    ctx.fillStyle = "#64748b"
    ctx.font = "500 38px system-ui, sans-serif"
    ctx.fillText(`Avaliação: ${im.avaliacao}`, pad, y + 20)
    y += 60
  }
  if (im.financiamento) {
    ctx.fillStyle = cor
    ctx.font = "700 38px system-ui, sans-serif"
    ctx.fillText("Aceita financiamento", pad, y + 20)
  }

  // Rodapé do corretor
  const fy = h - (story ? 330 : 230)
  ctx.fillStyle = "#f1f5f9"
  ctx.fillRect(0, fy, w, h - fy)
  let tx = pad
  if (c.foto) {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = c.foto
    await img.decode().catch(() => undefined)
    if (img.naturalWidth) {
      const s = 140
      ctx.save()
      ctx.beginPath()
      ctx.arc(pad + s / 2, fy + 45 + s / 2, s / 2, 0, Math.PI * 2)
      ctx.clip()
      const r = Math.max(s / img.naturalWidth, s / img.naturalHeight)
      ctx.drawImage(
        img,
        pad + (s - img.naturalWidth * r) / 2,
        fy + 45 + (s - img.naturalHeight * r) / 2,
        img.naturalWidth * r,
        img.naturalHeight * r
      )
      ctx.restore()
      tx = pad + s + 32
    }
  }
  ctx.fillStyle = "#0f172a"
  ctx.font = "800 44px system-ui, sans-serif"
  ctx.fillText(c.nome || "Seu nome", tx, fy + 90)
  ctx.fillStyle = "#334155"
  ctx.font = "600 34px system-ui, sans-serif"
  ctx.fillText([c.creci || "CRECI", c.whatsapp].filter(Boolean).join(" · "), tx, fy + 140)
  ctx.fillStyle = "#64748b"
  ctx.font = "500 26px system-ui, sans-serif"
  ctx.fillText(
    im.url ? `Ref. ${im.codigo} · Valores sujeitos ao edital · ${marca}` : marca,
    pad,
    h - 40
  )
}

export function AdKit({
  imovel: inicial,
  cor,
  marca,
  editavel = false,
}: {
  imovel: KitImovel
  cor: string
  marca: string
  editavel?: boolean
}) {
  const [c, setC] = React.useState<Corretor>({ nome: "", creci: "", whatsapp: "", foto: null })
  const [imovel, setImovel] = React.useState<KitImovel>(inicial)
  const [fotoImovel, setFotoImovel] = React.useState<string | null>(null)

  // Dados do corretor logado entram sozinhos (nome, CRECI, WhatsApp e foto).
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const sb = portalBrowserClient()
      const { data: u } = (await sb?.auth.getUser()) ?? { data: { user: null } }
      if (!sb || !u.user) return
      const { data: p } = await sb
        .from("perfis")
        .select("nome,creci,creci_uf,whatsapp,foto_path")
        .eq("user_id", u.user.id)
        .maybeSingle()
      if (!p) return
      setC((old) => ({
        nome: old.nome || p.nome || "",
        creci:
          old.creci || (p.creci ? `CRECI-${p.creci_uf ?? ""} ${p.creci}`.replace("- ", " ") : ""),
        whatsapp: old.whatsapp || p.whatsapp || "",
        foto:
          old.foto ||
          (p.foto_path
            ? sb.storage.from("corretores-fotos").getPublicUrl(p.foto_path).data.publicUrl
            : null),
      }))
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const [formato, setFormato] = React.useState<keyof typeof FORMATOS>("feed")
  const ref = React.useRef<HTMLCanvasElement>(null)
  const [copiado, setCopiado] = React.useState(false)

  React.useEffect(() => {
    if (ref.current) void desenhar(ref.current, formato, imovel, c, cor, marca, fotoImovel)
  }, [formato, imovel, c, cor, marca, fotoImovel])

  const legenda = [
    imovel.desconto
      ? `🔨 OPORTUNIDADE: ${Math.round(imovel.desconto)}% abaixo da avaliação!`
      : editavel
        ? "🏡 IMÓVEL À VENDA"
        : "🔨 IMÓVEL DE LEILÃO",
    "",
    `📍 ${imovel.titulo}, ${imovel.local}`,
    `💰 ${editavel ? "Valor" : "Lance mínimo"}: ${imovel.preco}${imovel.avaliacao ? ` | Avaliação: ${imovel.avaliacao}` : ""}`,
    [imovel.modalidade, imovel.origem].filter(Boolean).length
      ? `📄 ${[imovel.modalidade, imovel.origem].filter(Boolean).join(" · ")}`
      : "",
    imovel.financiamento ? "✅ Aceita financiamento" : "",
    "",
    editavel
      ? "Agende a sua visita e tire todas as dúvidas comigo."
      : "Eu faço a conta dos custos, confiro edital e matrícula e acompanho você até a chave na mão.",
    "",
    `📲 ${c.nome || "[seu nome]"}${c.creci ? ` | ${c.creci}` : ""}`,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : "",
    imovel.url ? `🔗 ${imovel.url}` : "",
    editavel ? "" : "Condições sujeitas ao edital. Confira edital e matrícula antes do lance.",
    "",
    editavel
      ? "#imoveis #imovelavenda #corretordeimoveis"
      : "#leilaodeimoveis #imoveldeleilao #investimentoimobiliario #oportunidade",
  ]
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")

  const baixar = () => {
    if (!ref.current) return
    const a = document.createElement("a")
    a.download = `anuncio-${imovel.codigo}-${formato}.png`
    a.href = ref.current.toDataURL("image/png")
    a.click()
  }

  const compartilhar = async () => {
    if (!ref.current) return
    const blob: Blob | null = await new Promise((r) => ref.current!.toBlob(r, "image/png"))
    const file = blob
      ? new File([blob], `anuncio-${imovel.codigo}.png`, { type: "image/png" })
      : null
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (file && nav.canShare?.({ files: [file] })) {
      await navigator
        .share({ files: [file], text: legenda, title: imovel.titulo })
        .catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(legenda).catch(() => undefined)
      setCopiado(true)
    }
  }

  const texto = encodeURIComponent(legenda)
  const link = encodeURIComponent(imovel.url)

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
          <legend className="px-1 text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
            Seus dados no anúncio
          </legend>
          {(
            [
              ["nome", "Nome"],
              ["creci", "CRECI (ex.: CRECI-RJ 00000)"],
              ["whatsapp", "WhatsApp"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              {label}
              <input
                value={c[k]}
                onChange={(e) => setC({ ...c, [k]: e.target.value })}
                className="h-11 rounded-lg border border-slate-300 px-3"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Sua foto ou logo (entra sozinha se estiver no seu cadastro)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const r = new FileReader()
                r.onload = () => setC((old) => ({ ...old, foto: String(r.result) }))
                r.readAsDataURL(f)
              }}
              className="text-sm"
            />
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5">
          <legend className="px-1 text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
            O imóvel no anúncio
          </legend>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Foto do imóvel (do seu aparelho)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const r = new FileReader()
                r.onload = () => setFotoImovel(String(r.result))
                r.readAsDataURL(f)
              }}
              className="text-sm"
            />
          </label>
          {editavel
            ? (
                [
                  ["origem", "Negócio (ex.: Venda, Locação)"],
                  ["titulo", "Título (ex.: Apartamento com 2 quartos)"],
                  ["local", "Bairro e cidade"],
                  ["preco", "Preço (ex.: R$ 350.000)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {label}
                  <input
                    value={imovel[k] ?? ""}
                    onChange={(e) => setImovel({ ...imovel, [k]: e.target.value })}
                    className="h-11 rounded-lg border border-slate-300 px-3"
                  />
                </label>
              ))
            : null}
        </fieldset>

        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-5">
          <span className="text-sm font-extrabold tracking-wide text-[var(--brand)] uppercase">
            Legenda pronta
          </span>
          <textarea
            readOnly
            value={legenda}
            rows={9}
            className="rounded-lg border border-slate-300 p-3 text-sm"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(legenda).catch(() => undefined)
              setCopiado(true)
            }}
            className="self-start rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
          >
            {copiado ? "Legenda copiada" : "Copiar legenda"}
          </button>
        </div>

        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          Ao publicar, você declara ser o responsável técnico pela intermediação deste imóvel. Sem
          parceria formal com a {marca}, a responsabilidade pelo anúncio e pelo atendimento é só
          sua.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {(Object.keys(FORMATOS) as (keyof typeof FORMATOS)[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormato(f)}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${formato === f ? "bg-[var(--brand)] text-white" : "border border-slate-300"}`}
            >
              {FORMATOS[f].nome}
            </button>
          ))}
        </div>
        <canvas
          ref={ref}
          className={`w-full rounded-2xl border border-slate-200 shadow-sm ${formato === "stories" ? "mx-auto max-w-[360px]" : "max-w-[540px]"}`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={baixar}
            className="rounded-xl bg-[var(--brand)] px-5 py-3 font-bold text-white"
          >
            Baixar arte
          </button>
          <button
            type="button"
            onClick={compartilhar}
            className="rounded-xl border-[1.5px] border-[var(--brand)] px-5 py-3 font-bold text-[var(--brand)]"
          >
            Compartilhar
          </button>
          <a
            href={`https://wa.me/?text=${texto}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-[#15803D] px-5 py-3 font-bold text-white"
          >
            WhatsApp
          </a>
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${link}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-300 px-5 py-3 font-bold"
          >
            Facebook
          </a>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${link}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-300 px-5 py-3 font-bold"
          >
            LinkedIn
          </a>
        </div>
        <p className="text-xs text-slate-500">
          Instagram: baixe a arte e publique pelo aplicativo, colando a legenda. A postagem
          automática nas redes entra na próxima etapa, com a conta comercial de cada corretor.
        </p>
      </div>
    </div>
  )
}
