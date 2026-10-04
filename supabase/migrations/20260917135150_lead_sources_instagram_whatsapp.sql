-- =============================================================================
-- Origens "Instagram" e "WhatsApp" para o lead
-- =============================================================================
-- Corretor que capta pela bio do Instagram e pelo WhatsApp pessoal precisa saber
-- se esses canais pagam a conta: antes eles caíam em "Redes sociais" ou "Outro".
-- Só os valores novos do enum (em migração própria: um valor novo de enum não
-- pode ser usado na mesma transação em que foi criado). Quem grava:
--   * cadastro manual (app) e importação de planilha ("instagram", "whatsapp");
--   * landing page com ?origem=instagram ou ?origem=whatsapp (migração seguinte).
-- Relatório de origem, exportação e investimentos já agrupam por lead_source.

alter type public.lead_source add value if not exists 'instagram' after 'social';
alter type public.lead_source add value if not exists 'whatsapp' after 'instagram';

comment on type public.lead_source is
  'Origem do lead: landing_page (formulário público), portal, website, social (outras redes sociais), instagram, whatsapp, referral (indicação), manual (cadastro manual) e other.';
