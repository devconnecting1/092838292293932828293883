-- =============================================================================
-- 2403 - Rodízio de leads: índices que faltavam nas chaves estrangeiras
-- =============================================================================
-- Apontados pelo Performance Advisor (0001 unindexed_foreign_keys) depois da
-- migração lead_roulette_sla. Sem eles, apagar uma imobiliária, um usuário ou um
-- corretor da fila varre a tabela filha inteira.

-- FK composta (organization_id, member_id) -> lead_routing_members.
create index if not exists lead_routing_shifts_organization_member_idx
  on public.lead_routing_shifts (organization_id, member_id);
-- Fica coberto pelo índice acima.
drop index if exists public.lead_routing_shifts_organization_idx;

-- FK to_user_id: o índice existente começa por organization_id e não serve.
create index if not exists lead_assignment_events_to_user_only_idx
  on public.lead_assignment_events (to_user_id);

create index if not exists lead_notifications_organization_idx
  on private.lead_notifications (organization_id);
create index if not exists lead_notifications_user_idx
  on private.lead_notifications (user_id);
