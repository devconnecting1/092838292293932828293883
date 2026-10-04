"use server"

import { isStateCode } from "@workspace/core/br/states"

import { getCurrentUser } from "@/lib/auth/session"
import { lookupCep, type CepAddress } from "@/lib/br/cep"

export type CepLookupResult = { ok: true; data: CepAddress } | { ok: false; error: string }

/** Consulta de CEP (ViaCEP com fallback BrasilAPI) para os formulários do CRM. */
export async function lookupCepAction(value: string): Promise<CepLookupResult> {
  const user = await getCurrentUser()

  if (!user) {
    return { ok: false, error: "Sua sessão expirou. Entre novamente." }
  }

  const postalCode = String(value ?? "").replace(/\D/g, "")

  if (postalCode.length !== 8) {
    return { ok: false, error: "CEP inválido. Informe os 8 dígitos." }
  }

  const address = await lookupCep(postalCode)

  if (!address) {
    return {
      ok: false,
      error: "CEP não encontrado. Preencha o endereço manualmente.",
    }
  }

  const state = address.state.toUpperCase()

  return {
    ok: true,
    data: { ...address, state: isStateCode(state) ? state : "" },
  }
}
