# Integrações com portais (Vamos Arrematar)

## Grupo OLX (ZAP Imóveis, Viva Real, OLX)
- Anúncios: feed VRSync em `/api/feeds/portal/grupo-olx?token=<PORTAL_FEED_TOKEN>` (cadastrar no Canal Pro).
- Leads: `POST /api/webhooks/portal/grupo-olx`
  - integrador credenciado: Basic `usuario:SECRET_KEY` (env `GRUPO_OLX_SECRET_KEY`, recebida do Grupo OLX);
  - URL colada no Canal Pro: `?token=<PORTAL_LEADS_TOKEN>`.
  - Grava em `leads` (origem `grupo-olx`), com o código do anúncio (`clientListingId`) ligado ao imóvel.

## Imovelweb (Open API Navent)
- Cliente TypeScript em `apps/web/lib/portal/imovelweb.ts` (portado do SDK PHP mrprompt/imovelweb-sdk, MIT).
- Envs: `IMOVELWEB_CLIENT_ID`, `IMOVELWEB_CLIENT_SECRET`, `IMOVELWEB_CODIGO_IMOBILIARIA`,
  `IMOVELWEB_AMBIENTE` (sandbox|production), `IMOVELWEB_CALLBACK_SECRET` (gerado por nós).
- Publicar: `POST /api/webhooks/portal/imovelweb/sincronizar` com `Authorization: Bearer <PORTAL_LEADS_TOKEN>`.
  Publica os anúncios aprovados para o portal `imovelweb` e registra o callback de leads.
- Leads: `POST /api/webhooks/portal/imovelweb` (header `X-Vamos-Arrematar: <IMOVELWEB_CALLBACK_SECRET>`).
