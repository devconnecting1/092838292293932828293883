-- =============================================================================
-- Menor privilégio nas RPCs apontadas pelo Security Advisor
-- =============================================================================
-- Lints 0028/0029 (security definer executável por anon/authenticated):
-- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
-- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
--
-- 1. RPCs públicas que o servidor chama SEMPRE com o cliente anônimo (chave
--    publishable, sem cookies nem sessão): get_public_organization
--    (lib/captacao, lib/email, lib/tenant), get_public_landing_page
--    (lib/leads-publicos, lib/email), get_public_status (lib/status),
--    get_shared_proposal e register_shared_proposal_view (lib/propostas/share).
--    Ninguém as chama com sessão: EXECUTE fica só com anon, como já era em
--    get_public_property e get_public_sitemap. get_portal_feed e
--    get_invitation_preview continuam com authenticated (a prévia do feed e a
--    página do convite usam o cliente com sessão).
--
-- 2. get_lead_stage_metrics passa a security invoker: dono, gerente e
--    assistente já leem todos os leads e todo o histórico de etapa da
--    imobiliária pelo RLS (private.can_access_lead_row), então o resultado é o
--    mesmo e o RLS vira a segunda barreira. A checagem de papel continua na
--    primeira linha.
--
-- 3. lead_integrations: o SELECT da tabela inteira para authenticated (privilégio
--    padrão do Supabase, nunca revogado) anulava o grant por coluna da migração
--    external_lead_ingest, e webhook_token, secret_id e poll_cursor ficavam
--    legíveis direto pela API para dono/gerente. Volta ao desenho documentado:
--    SELECT só nas colunas listadas; o endereço do webhook sai só por
--    get_lead_integrations_overview e enable_lead_webhook (que por isso seguem
--    security definer). O app só lê status, last_event_at e
--    external_account_id direto da tabela.
-- =============================================================================

-- 1. RPCs públicas: só anon ------------------------------------------------------
revoke execute on function public.get_public_organization(text) from public, authenticated;
revoke execute on function public.get_public_landing_page(text, text) from public, authenticated;
revoke execute on function public.get_public_status() from public, authenticated;
revoke execute on function public.get_shared_proposal(text) from public, authenticated;
revoke execute on function public.register_shared_proposal_view(text) from public, authenticated;

grant execute on function public.get_public_organization(text) to anon;
grant execute on function public.get_public_landing_page(text, text) to anon;
grant execute on function public.get_public_status() to anon;
grant execute on function public.get_shared_proposal(text) to anon;
grant execute on function public.register_shared_proposal_view(text) to anon;

comment on function public.get_public_status() is
  'Página de status pública (só anon, sem chave; o servidor chama sem sessão): retrato no formato PublicStatusSnapshot (packages/core/src/status/public.ts). Por parte: nível atual (pior entre incidente em aberto e medição automática dos últimos 10 min; manutenção em andamento mostra under_maintenance e ignora a medição, mas incidente pior vence), disponibilidade de 90 dias e barra de 90 dias (dia de São Paulo: disponibilidade do resumo diário, pior nível entre medição, incidentes e manutenção, ids dos incidentes do dia). automaticSignal = a parte tem sinal automático ligado (private.status_component_signal_configured), para a página dizer se falta medição ou se só a equipe acompanha. Situação geral = pior parte. Incidentes ativos (inclui manutenção em andamento), manutenções agendadas e resolvidos dos últimos 14 dias (até 50). Só dado público: nada de quem criou, filas, rotinas ou detalhes da medição.';

comment on function public.get_shared_proposal(text) is
  'Link público da proposta: documento da proposta para token de 48 caracteres válido e não vencido; null para token errado, revogado ou vencido, sem distinguir os casos. EXECUTE só para anon (o servidor chama sem sessão).';

comment on function public.register_shared_proposal_view(text) is
  'Marca a leitura do link público da proposta (no máximo uma vez por minuto por token). Token errado ou vencido não faz nada. EXECUTE só para anon (o servidor chama sem sessão).';

-- 2. get_lead_stage_metrics: security invoker ------------------------------------
alter function public.get_lead_stage_metrics(uuid, integer) security invoker;

comment on function public.get_lead_stage_metrics(uuid, integer) is
  'Conversão por etapa e tempo em cada fase (mediana e média) a partir de public.lead_stage_events, mais o resumo do período. Dono, gerente e assistente. security invoker: o RLS de leads e lead_stage_events também filtra (esses papéis enxergam a imobiliária inteira).';

-- 3. lead_integrations: SELECT só por coluna -------------------------------------
-- Revogar o SELECT da tabela também revoga os grants por coluna; eles voltam logo
-- abaixo, com a mesma lista da migração external_lead_ingest.
revoke select on public.lead_integrations from authenticated;

grant select (
  id, organization_id, provider, status, external_account_id, account_label, config,
  connected_at, connected_by, last_event_at, last_success_at, last_error_at, last_error,
  last_test_at, created_at, updated_at
) on public.lead_integrations to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.lead_integrations', 'select')
     or has_column_privilege('authenticated', 'public.lead_integrations', 'webhook_token', 'select')
     or has_column_privilege('authenticated', 'public.lead_integrations', 'secret_id', 'select')
     or has_column_privilege('authenticated', 'public.lead_integrations', 'poll_cursor', 'select')
     or not has_column_privilege('authenticated', 'public.lead_integrations', 'status', 'select') then
    raise exception 'Grant de SELECT em lead_integrations ficou diferente do esperado.';
  end if;

  if has_function_privilege('authenticated', 'public.get_public_status()', 'execute')
     or not has_function_privilege('anon', 'public.get_public_status()', 'execute') then
    raise exception 'EXECUTE de get_public_status ficou diferente do esperado.';
  end if;
end;
$$;
