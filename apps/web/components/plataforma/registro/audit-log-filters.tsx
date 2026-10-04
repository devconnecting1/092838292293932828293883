"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FilterXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

export type AuditFilterOption = { value: string; label: string }

const REGISTRY_PATH = "/plataforma/registro"

function hrefFor(action: string, organization: string): string {
  const params = new URLSearchParams()

  if (action) params.set("acao", action)
  if (organization) params.set("imobiliaria", organization)

  const query = params.toString()
  return query ? `${REGISTRY_PATH}?${query}` : REGISTRY_PATH
}

/** Filtros do registro (ação e imobiliária), na URL. Mudar volta para os mais recentes. */
export function AuditLogFilters({
  action,
  organization,
  actions,
  organizations,
}: {
  action: string
  organization: string
  actions: readonly AuditFilterOption[]
  organizations: readonly AuditFilterOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const actionItems = [{ value: null, label: "Todas as ações" }, ...actions]
  const organizationItems = [{ value: null, label: "Todas as imobiliárias" }, ...organizations]

  function navigate(nextAction: string, nextOrganization: string) {
    startTransition(() => {
      router.replace(hrefFor(nextAction, nextOrganization), { scroll: false })
    })
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <Select
        items={actionItems}
        value={action || null}
        onValueChange={(value) => navigate(typeof value === "string" ? value : "", organization)}
      >
        <SelectTrigger className="w-full md:w-64" aria-label="Filtrar por ação">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {actionItems.map((item) => (
              <SelectItem key={item.value ?? "todas"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        items={organizationItems}
        value={organization || null}
        onValueChange={(value) => navigate(action, typeof value === "string" ? value : "")}
      >
        <SelectTrigger className="w-full md:w-64" aria-label="Filtrar por imobiliária">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {organizationItems.map((item) => (
              <SelectItem key={item.value ?? "todas"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {isPending ? <Spinner aria-label="Atualizando" /> : null}

      {action || organization ? (
        <Button variant="ghost" onClick={() => navigate("", "")}>
          <FilterXIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}
