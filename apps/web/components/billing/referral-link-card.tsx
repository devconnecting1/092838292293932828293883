"use client"

import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react"

import { TRIAL_DAYS } from "@workspace/core/billing"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

import { useCopyToClipboard } from "@/components/configuracoes/copy-field"
import { APP_NAME } from "@/components/crm/brand"

/** Link de indicação com copiar e compartilhar no WhatsApp. */
export function ReferralLinkCard({ url, code }: { url: string; code: string }) {
  const { copied, copy } = useCopyToClipboard()
  const message = `Estou usando o ${APP_NAME} para organizar imóveis, clientes e leads. Crie sua conta pelo meu link e teste grátis por ${TRIAL_DAYS} dias: ${url}`
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seu link de indicação</CardTitle>
        <CardDescription>
          Envie para imobiliárias e corretores. Quem criar a conta por ele fica ligado a você.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="indicacao-link">Link</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="indicacao-link"
              value={url}
              readOnly
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={() => copy(url, "Link de indicação copiado.")}>
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "Copiado" : "Copiar"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            Seu código: <span className="font-mono tracking-wider">{code}</span>
          </FieldDescription>
        </Field>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          render={<a href={whatsappUrl} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          <MessageCircleIcon data-icon="inline-start" />
          Compartilhar no WhatsApp
          <span className="sr-only"> (abre em nova aba)</span>
        </Button>
      </CardFooter>
    </Card>
  )
}
