-- =============================================================================
-- 1330 - Consentimento (LGPD) no cadastro manual de leads
-- =============================================================================
-- O cadastro manual (ex.: atendimento por telefone) passa a registrar
-- consent_at. Data futura é recusada (tolerância de 5 minutos para diferença de
-- relógio). utm, click_ids, landing_url, referrer, event_id e landing_page_id
-- continuam exclusivos de submit_landing_lead.

-- CHECK: vale para qualquer gravação (inclusive service_role). Uma data aceita
-- continua válida com o passar do tempo.
alter table public.leads
  add constraint leads_consent_at_not_future
    check (consent_at is null or consent_at <= now() + interval '5 minutes');

-- Mensagem pt-BR antes da CHECK (mesmo trigger de normalização de leads).
create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if char_length(coalesce(new.name, '')) not between 2 and 120 then
    raise exception 'Informe o nome do lead (2 a 120 caracteres).' using errcode = '23514';
  end if;

  if new.email is not null and (
    char_length(new.email) > 254
    or new.email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in new.email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '23514';
  end if;

  if new.phone is not null and new.phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '23514';
  end if;

  if new.consent_at is not null
     and (tg_op = 'INSERT' or new.consent_at is distinct from old.consent_at)
     and new.consent_at > now() + interval '5 minutes' then
    raise exception 'A data do consentimento não pode estar no futuro.' using errcode = '23514';
  end if;

  if new.stage = 'lost' and new.lost_reason is null then
    raise exception 'Informe o motivo da perda do lead.' using errcode = '23514';
  end if;

  if new.stage <> 'new'
     and new.last_contact_at is null
     and (tg_op = 'INSERT' or old.stage = 'new') then
    new.last_contact_at := now();
  end if;

  return new;
end;
$$;

revoke all on function private.leads_before_write() from public, anon, authenticated;

-- INSERT de consent_at pelo app (UPDATE continua sem essa coluna).
grant insert (consent_at) on public.leads to authenticated;
