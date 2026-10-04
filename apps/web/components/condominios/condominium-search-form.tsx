import Form from "next/form"
import Link from "next/link"
import { SearchIcon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"

import { CONDOMINIUM_SEARCH_MAX_LENGTH, CONDOMINIUMS_PATH } from "@/lib/condominios/search"

/**
 * Busca por GET (?q=) com navegação no cliente. Enviar a busca descarta
 * `pagina`, voltando para a primeira página.
 */
export function CondominiumSearchForm({ query }: { query: string }) {
  return (
    <Form
      action={CONDOMINIUMS_PATH}
      role="search"
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
    >
      <InputGroup className="sm:max-w-md">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          key={query}
          type="search"
          name="q"
          defaultValue={query}
          maxLength={CONDOMINIUM_SEARCH_MAX_LENGTH}
          placeholder="Buscar por nome, bairro ou cidade"
          aria-label="Buscar condomínios por nome, bairro ou cidade"
        />
      </InputGroup>
      <div className="flex gap-2">
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {query ? (
          <Button variant="ghost" render={<Link href={CONDOMINIUMS_PATH} />} nativeButton={false}>
            <XIcon data-icon="inline-start" />
            Limpar busca
          </Button>
        ) : null}
      </div>
    </Form>
  )
}
