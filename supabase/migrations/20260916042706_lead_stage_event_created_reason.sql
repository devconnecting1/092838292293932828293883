-- =============================================================================
-- 2402 - Histórico: o evento de criação registra o canal, não a roleta
-- =============================================================================
-- O primeiro lead_stage_events de um lead significa "entrou no funil". O motivo
-- certo ali é o canal de entrada ('landing_page' ou 'created'); 'roulette' é
-- motivo de ATRIBUIÇÃO e continua em lead_assignment_events.

create or replace function private.leads_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := left(nullif(btrim(coalesce(current_setting('app.lead_event_reason', true), '')), ''), 40);
  v_insert_reason text := left(nullif(btrim(coalesce(current_setting('app.lead_insert_reason', true), '')), ''), 40);
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    -- Etapa: o lead entrou no funil pelo canal X.
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (
      new.organization_id, new.id, null, new.stage, v_actor,
      case when new.source = 'landing_page' then 'landing_page' else 'created' end
    );

    -- Atribuição: quem decidiu o responsável (roleta, página, cadastro manual).
    if new.assigned_to is not null then
      v_reason := coalesce(v_insert_reason, v_reason, 'created');

      insert into public.lead_assignment_events (
        organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
      )
      values (
        new.organization_id, new.id, null, new.assigned_to, v_actor,
        case
          when v_reason in (
            'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
            'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
          ) then v_reason
          else 'created'
        end
      );

      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;

    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (new.organization_id, new.id, old.stage, new.stage, v_actor, v_reason);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_assignment_events (
      organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
    )
    values (
      new.organization_id, new.id, old.assigned_to, new.assigned_to, v_actor,
      case
        when v_reason in (
          'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
          'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
        ) then v_reason
        else 'manual'
      end
    );

    if new.assigned_to is not null then
      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;
  end if;

  return null;
end;
$$;

comment on function private.leads_log_events() is
  'Trigger AFTER em public.leads: grava lead_stage_events (etapa) e lead_assignment_events (responsável). Na criação, a etapa registra o canal (landing_page/created) e a atribuição registra quem decidiu (app.lead_insert_reason, escrito por leads_apply_roulette). Nos UPDATE, o motivo vem de app.lead_event_reason.';

revoke all on function private.leads_log_events() from public, anon, authenticated;
