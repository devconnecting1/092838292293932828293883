"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/toast"

export function PublicLinkCard({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.add({ title: "Link copiado.", type: "success" })
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({
        title: "Não foi possível copiar",
        description: "Selecione o link e copie manualmente.",
        type: "error",
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link público de captação</CardTitle>
        <CardDescription>
          Divulgue no site, nas redes sociais e no WhatsApp. Os proprietários que preencherem o
          formulário aparecem nesta caixa de entrada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="captacao-link-publico" className="sr-only">
            Link público de captação
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="captacao-link-publico"
              value={url}
              readOnly
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={copyLink}>
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "Copiado" : "Copiar"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          render={<a href={url} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Abrir formulário
        </Button>
      </CardFooter>
    </Card>
  )
}
