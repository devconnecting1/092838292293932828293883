"use client"

import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

type CookieConsentBannerProps = {
  privacyHref: string
  onAccept: () => void
  onDecline: () => void
}

/** Aviso discreto de cookies de medição, fixo no rodapé até a escolha. */
export function CookieConsentBanner({
  privacyHref,
  onAccept,
  onDecline,
}: CookieConsentBannerProps) {
  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4"
    >
      <Card size="sm" className="mx-auto w-full max-w-3xl shadow-lg">
        <CardHeader>
          <CardTitle>Cookies de medição</CardTitle>
          <CardDescription>
            Com a sua permissão, usamos cookies de parceiros como Meta e Google para medir o
            resultado dos anúncios. Sem aceitar, a página funciona normalmente.{" "}
            <Link href={privacyHref} className="underline underline-offset-4">
              Política de privacidade
            </Link>
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onDecline}>
            Recusar
          </Button>
          <Button onClick={onAccept}>Aceitar</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
