import "server-only"

/**
 * Chaves VAPID dos avisos no celular (Web Push).
 *
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY: chave pública (65 bytes, base64url). Vai para
 *   o navegador na inscrição; aqui ela é lida no servidor e passada por props.
 * - VAPID_PRIVATE_KEY: chave privada (32 bytes, base64url). Só no servidor.
 * - VAPID_SUBJECT: contato do remetente (`mailto:` do suporte ou URL https).
 *
 * Sem as três (ou com alguma inválida) os avisos no celular ficam desligados:
 * a opção some de "Meu perfil" e a fila de avisos manda só o e-mail. Os logs
 * nunca levam o valor de nenhuma chave.
 */

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

let warnedInvalid = false

function decodedLength(value: string): number | null {
  const unpadded = value.replace(/=+$/, "")
  return BASE64URL.test(unpadded) ? Buffer.from(unpadded, "base64url").length : null
}

function isValidPublicKey(value: string) {
  const unpadded = value.replace(/=+$/, "")
  return (
    decodedLength(unpadded) === 65 && Buffer.from(unpadded, "base64url")[0] === 0x04 // ponto P-256 não comprimido
  )
}

function isValidSubject(value: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol === "mailto:") {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(decodeURIComponent(url.pathname))
  }

  // O serviço de push da Apple recusa subject em localhost (BadJwtToken).
  return url.protocol === "https:" && url.hostname !== "localhost"
}

/** Configuração válida ou null (avisos no celular desligados). */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim().replace(/=+$/, "") ?? ""
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim().replace(/=+$/, "") ?? ""
  const subject = process.env.VAPID_SUBJECT?.trim() ?? ""

  if (!publicKey && !privateKey && !subject) {
    return null
  }

  if (
    !isValidPublicKey(publicKey) ||
    decodedLength(privateKey) !== 32 ||
    !isValidSubject(subject)
  ) {
    if (!warnedInvalid) {
      warnedInvalid = true
      console.error(
        "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT ausente ou inválida: avisos no celular desligados"
      )
    }

    return null
  }

  return { publicKey, privateKey, subject }
}
