"use client"

import * as React from "react"

import { portalBrowserClient } from "@/lib/portal/browser-client"
import { CONFIG_PADRAO, montarConfig, type ConfigPortal } from "@/lib/portal/config-portal"
import { aplicarAjustePlanos, PLANOS, type Plano } from "@/lib/portal/planos"

/** Configuração do portal no navegador; começa com os padrões e atualiza com o banco. */
export function useConfigPortal() {
  const [cfg, setCfg] = React.useState<ConfigPortal>(CONFIG_PADRAO)
  React.useEffect(() => {
    const sb = portalBrowserClient()
    if (!sb) return
    void sb
      .from("config_portal")
      .select("chave, valor")
      .then(({ data }) => {
        if (data) setCfg(montarConfig(data as { chave: string; valor: unknown }[]))
      })
  }, [])
  return cfg
}

/** Planos com os preços definidos pelo CEO. */
export function usePlanos(): Plano[] {
  const cfg = useConfigPortal()
  return React.useMemo(
    () => (Object.keys(cfg.planos).length ? aplicarAjustePlanos(cfg.planos) : PLANOS),
    [cfg]
  )
}
