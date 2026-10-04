-- Conta bloqueada pela equipe da plataforma (Console → Imobiliárias) não recebe
-- os e-mails de cobrança ("teste acabando", "pagamento pendente", "modo
-- leitura"): o motivo do bloqueio é outro, e o aviso induziria o dono a pagar
-- achando que isso libera a conta. Só acrescenta o filtro; o resto da função é
-- o mesmo de antes.
create or replace function public.list_billing_reminders(p_server_key text default null, p_kind text default null)
 returns table(organization_id uuid, organization_slug text, organization_name text, owner_emails text[], notice_date timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_kind is null
     or p_kind not in ('trial_ending_3d', 'trial_ending_1d', 'past_due', 'read_only_today') then
    raise exception 'Tipo de aviso inválido.' using errcode = '22023';
  end if;

  return query
  with accounts as (
    select
      b.organization_id as org_id,
      o.slug as org_slug,
      o.name as org_name,
      b.status as billing_status,
      private.billing_period_end(b.status, b.plan_key, b.trial_ends_at, b.current_period_end) as period_end,
      private.billing_grace_ends_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end) as grace_end,
      private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, now()) as state
    from public.billing_accounts b
    join public.organizations o on o.id = b.organization_id
    where b.platform_blocked_at is null
  )
  select
    a.org_id,
    a.org_slug,
    a.org_name,
    e.emails,
    case when p_kind like 'trial_%' then a.period_end else a.grace_end end
  from accounts a
  cross join lateral (
    select array_agg(distinct lower(u.email) order by lower(u.email)) as emails
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = a.org_id
      and m.role = 'owner'
      and m.active
      and u.email is not null
  ) e
  where e.emails is not null
    and case p_kind
      when 'trial_ending_3d' then
        a.state = 'trialing'
        and a.period_end > now() + interval '2 days'
        and a.period_end <= now() + interval '3 days'
      when 'trial_ending_1d' then
        a.state = 'trialing'
        and a.period_end <= now() + interval '1 day'
      when 'past_due' then
        a.billing_status in ('past_due', 'unpaid', 'incomplete') and a.state = 'grace'
      else
        a.state = 'read_only' and a.grace_end >= now() - interval '1 day'
    end
  order by case when p_kind like 'trial_%' then a.period_end else a.grace_end end, a.org_id
  limit 500;
end;
$function$;

comment on function public.list_billing_reminders(text, text) is
  'Donos a avisar por e-mail sobre a assinatura (teste acabando, pagamento pendente, modo leitura). Só com BILLING_SERVER_KEY; ignora contas bloqueadas pela plataforma.';

revoke all on function public.list_billing_reminders(text, text) from public, authenticated;
grant execute on function public.list_billing_reminders(text, text) to anon;
