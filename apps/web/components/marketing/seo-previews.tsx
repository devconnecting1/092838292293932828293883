import { ImageIcon } from "lucide-react"

import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { displayUrl } from "@/lib/marketing/urls"

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

/** Como a página aparece num resultado de busca. */
export function SearchResultPreview({
  siteName,
  url,
  title,
  description,
}: {
  siteName: string
  url: string
  title: string
  description: string
}) {
  const initial = siteName.trim().charAt(0).toUpperCase() || "L"

  return (
    <div
      className="flex flex-col gap-1 rounded-xl border bg-background p-4"
      aria-label="Prévia no resultado de busca"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{siteName}</span>
          <span className="truncate text-xs text-muted-foreground">{displayUrl(url)}</span>
        </div>
      </div>
      <p className="text-lg leading-snug text-primary">
        {title ? (
          truncate(title, 70)
        ) : (
          <span className="text-muted-foreground">Título da página</span>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {description
          ? truncate(description, 160)
          : "Descrição que aparece abaixo do título no resultado de busca."}
      </p>
    </div>
  )
}

/** Como o link aparece ao ser compartilhado (WhatsApp, Facebook, LinkedIn). */
export function SharePreview({
  url,
  title,
  description,
  imageUrl,
}: {
  url: string
  title: string
  description: string
  imageUrl: string | null
}) {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    host = displayUrl(url)
  }

  return (
    <Card size="sm" className="max-w-md" aria-label="Prévia do compartilhamento">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" />
      ) : (
        <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted text-muted-foreground">
          <ImageIcon aria-hidden="true" />
        </div>
      )}
      <CardHeader>
        <span className="truncate text-xs text-muted-foreground uppercase">{host}</span>
        <CardTitle className="line-clamp-2">{title || "Título da página"}</CardTitle>
        <CardDescription className="line-clamp-2">
          {description || "Descrição exibida no cartão do link."}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
