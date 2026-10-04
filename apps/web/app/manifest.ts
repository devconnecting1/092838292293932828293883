import type { MetadataRoute } from "next"

import { APP_NAME } from "@/components/crm/brand"

/**
 * Manifesto do app instalável (PWA), servido em /manifest.webmanifest.
 * Guia: https://nextjs.org/docs/app/guides/progressive-web-apps
 *
 * `display: "standalone"` é o que permite o push no iPhone/iPad: o WebKit só
 * libera Web Push para o site adicionado à tela de início como web app
 * (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
 * Ícones gerados da própria marca (BrandMark) em public/icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Leads, imóveis, clientes e agenda da imobiliária, com avisos de lead no celular.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // --background do tema claro (globals.css): barra do app igual ao cabeçalho do CRM.
    background_color: "#f5f5f5",
    theme_color: "#f5f5f5",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  }
}
