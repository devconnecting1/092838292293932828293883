/** Endereço público do portal, para links em anúncios e feeds. */
export function siteUrl() {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return (v && /^https?:\/\//.test(v) ? v : "https://vamosarrematar.com.br").replace(/\/+$/, "")
}
