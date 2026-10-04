import { describe, expect, it } from "vitest"

import {
  classifySubmitError,
  isNetworkError,
  OFFLINE_SUBMIT_MESSAGE,
  submitFailureMessage,
  UNEXPECTED_SUBMIT_MESSAGE,
} from "./submit-error"

describe("isNetworkError", () => {
  it("reconhece as mensagens de fetch sem rede dos navegadores", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true)
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(
      true
    )
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true)
    expect(isNetworkError(new TypeError("The network connection was lost."))).toBe(true)
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true)
  })

  it("procura na causa encadeada", () => {
    const wrapped = new Error("Server action failed", { cause: new TypeError("Failed to fetch") })
    expect(isNetworkError(wrapped)).toBe(true)
  })

  it("não confunde erro do servidor com queda de rede", () => {
    expect(isNetworkError(new Error("An error occurred in the Server Components render."))).toBe(
      false
    )
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
    expect(isNetworkError({ message: 42 })).toBe(false)
  })
})

describe("classifySubmitError", () => {
  it("navegador off-line conta como sem conexão, qualquer que seja o erro", () => {
    expect(classifySubmitError(new Error("qualquer"), { online: false })).toBe("offline")
  })

  it("falha de fetch é sem conexão; o resto é inesperado", () => {
    expect(classifySubmitError(new TypeError("Failed to fetch"), { online: true })).toBe("offline")
    expect(classifySubmitError(new Error("boom"), { online: true })).toBe("unexpected")
    expect(classifySubmitError("boom")).toBe("unexpected")
  })
})

describe("submitFailureMessage", () => {
  it("avisa que os dados continuam na tela", () => {
    expect(submitFailureMessage("offline")).toBe(OFFLINE_SUBMIT_MESSAGE)
    expect(submitFailureMessage("unexpected")).toBe(UNEXPECTED_SUBMIT_MESSAGE)
    expect(OFFLINE_SUBMIT_MESSAGE).toContain("Seus dados continuam aqui")
  })
})
