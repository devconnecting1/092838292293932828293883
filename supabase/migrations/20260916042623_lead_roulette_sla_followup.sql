-- =============================================================================
-- 2401 - Rodízio de leads: motivo correto no histórico do lead recém-criado
-- =============================================================================
-- Na migração anterior, o lead entregue pela roleta no próprio INSERT ficava
-- registrado em lead_assignment_events como 'created' (o motivo só era
-- informado nos UPDATE, por app.lead_event_reason). O histórico precisa dizer
-- "distribuído pelo rodízio", que é o que o gestor quer ver.
--
-- Solução: um segundo ajuste de sessão, app.lead_insert_reason, escrito pelo
-- trigger BEFORE INSERT (private.leads_apply_roulette) e lido pelo trigger
-- AFTER (private.leads_log_events). Como o BEFORE grava o valor em TODA
-- inserção de lead, não sobra valor antigo de outra operação da transação.
--
-- Atenção: private.leads_log_events é redefinida logo depois, na migração
-- lead_stage_event_created_reason; aqui fica a versão intermediária, na ordem
-- em que foi aplicada no projeto.

create or replace function private.leads_apply_roulette()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_now timestamptz := now();
  v_picked uuid;
begin
  -- Motivo padrão deste INSERT (o trigger AFTER consome).
  perform set_config(
    'app.lead_insert_reason',
    case when new.source = 'landing_page' then 'landing_page' else 'created' end,
    true
  );

  if new.stage <> 'new' then
    return new;
  end if;

  if new.source is distinct from 'landing_page' and new.assigned_to is not null then
    return new;
  end if;

  v_config := private.lead_routing_config(new.organization_id);

  if not v_config.roulette_enabled then
    return new;
  end if;

  v_picked := private.lead_routing_pick(new.organization_id, v_now, '{}'::uuid[]);

  if v_picked is not null then
    new.assigned_to := v_picked;
    new.routing_due_at := null;
    perform set_config('app.lead_insert_reason', 'roulette', true);
    return new;
  end if;

  -- Ninguém de plantão agora: cai no responsável fixo da página, quando houver.
  if new.source is not distinct from 'landing_page'
     and v_config.fallback_to_page_assignee
     and new.assigned_to is not null then
    new.routing_due_at := null;
    return new;
  end if;

  new.assigned_to := null;

  if private.lead_routing_has_queue(new.organization_id, v_now, '{}'::uuid[]) then
    new.routing_due_at := coalesce(
      private.lead_routing_next_window(new.organization_id, v_now, '{}'::uuid[]),
      v_now + interval '15 minutes'
    );
  else
    new.routing_due_at := null;
  end if;

  return new;
end;
$$;

comment on function private.leads_apply_roulette() is
  'Trigger BEFORE INSERT em public.leads: com o rodízio ligado, o responsável do lead novo sai da roleta (e não do responsável fixo da landing page). Fora do horário de plantão o lead fica com routing_due_at na próxima janela. Também grava app.lead_insert_reason, o motivo que o histórico registra.';

revoke all on function private.leads_apply_roulette() from public, anon, authenticated;

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
    -- No INSERT vale o motivo do próprio INSERT (roleta, landing page, cadastro).
    v_reason := coalesce(v_insert_reason, v_reason, 'created');

    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (new.organization_id, new.id, null, new.stage, v_actor, v_reason);

    if new.assigned_to is not null then
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
  'Trigger AFTER em public.leads: grava lead_stage_events e lead_assignment_events. O motivo vem de app.lead_insert_reason (INSERT, escrito por leads_apply_roulette) ou de app.lead_event_reason (UPDATE, escrito pelas RPCs e pela passada agendada).';

revoke all on function private.leads_log_events() from public, anon, authenticated;
