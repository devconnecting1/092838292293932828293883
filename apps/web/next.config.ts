import type { NextConfig } from "next"

/**
 * CSP do app (só diretivas que não dependem de nonce). A ficha do imóvel em PDF
 * troca apenas `object-src`: o visualizador de PDF do navegador é um objeto
 * embutido e não abre com `object-src 'none'`.
 */
function contentSecurityPolicy(objectSrc: "'none'" | "'self'") {
  return `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src ${objectSrc}`
}

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/core", "@workspace/database"],
  // Sem experimental.inlineCss: com ele o CSS ia inline e repetido no payload do React
  // (HTML de 871 KB a cada primeiro acesso, sem cache do CSS, e um script inline enorme
  // apontado pelo PageSpeed). A folha externa fica em cache entre as páginas.
  // Sem productionBrowserSourceMaps: a Vercel responde 403 aos .map publicados, então só
  // alongavam o build.
  // Server Actions recebem senha, CPF e documentos: não imprimir argumentos no terminal.
  logging: {
    serverFunctions: false,
  },
  async redirects() {
    return [
      {
        // A antiga página de demonstração do modelo (dados de exemplo) foi removida:
        // links salvos caem no painel. Temporário (307) para o navegador não guardar
        // o desvio para sempre, caso a rota volte a ser usada.
        source: "/dashboard/:path*",
        destination: "/painel",
        permanent: false,
      },
    ]
  },
  async headers() {
    // Impede embutir o CRM em iframe de terceiros (clickjacking em convites, equipe e
    // feed). Vale em qualquer ambiente: nenhum site de fora embute o app.
    const securityHeaders = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'") },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ]

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      })
    }

    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Link público da proposta: fora dos buscadores e sem vazar o token no
        // Referer de qualquer link que o cliente clique na página.
        // (Regra depois da geral: para a mesma chave, vale a última.)
        source: "/proposta/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Ficha do imóvel em PDF (/api/imoveis/{id}/ficha?abrir=1 abre na aba): só
        // esta rota libera `object-src 'self'`; o resto da CSP e os demais
        // cabeçalhos continuam os da regra geral. Um segmento só (`:id`), sem
        // curinga, para não alcançar outras rotas.
        // (Regra depois da geral: para a mesma chave, vale a última.)
        source: "/api/imoveis/:id/ficha",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy("'self'") }],
      },
      {
        // Service worker dos avisos no celular (public/sw.js), como no guia de PWA do
        // Next.js (https://nextjs.org/docs/app/guides/progressive-web-apps): sem cache,
        // para a versão nova valer na próxima visita, e CSP só com a própria origem.
        // (Regra depois da geral: para a mesma chave, vale a última.)
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
