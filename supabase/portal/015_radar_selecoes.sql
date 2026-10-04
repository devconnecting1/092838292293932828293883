-- Radar de oportunidades (filtros salvos por usuário) e seleções compartilháveis:
-- o usuário marca imóveis e gera um link público com a cara dele (foto, nome, CRECI, WhatsApp).
create table if not exists public.radares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null default 'Meu radar' check (char_length(nome) between 2 and 60),
  criterios jsonb not null default '{}'::jsonb,
  criado timestamptz not null default now()
);
create index if not exists radares_user on public.radares (user_id);
alter table public.radares enable row level security;
drop policy if exists radares_dono on public.radares;
create policy radares_dono on public.radares for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.selecoes (
  codigo text primary key default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default 'Oportunidades selecionadas' check (char_length(titulo) between 2 and 120),
  mensagem text check (mensagem is null or char_length(mensagem) <= 600),
  imoveis text[] not null check (cardinality(imoveis) between 1 and 60),
  criado timestamptz not null default now()
);
alter table public.selecoes enable row level security;
drop policy if exists selecoes_dono on public.selecoes;
create policy selecoes_dono on public.selecoes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Página pública da seleção: imóveis ativos + dados de vitrine de quem compartilhou.
create or replace function public.selecao_publica(p_codigo text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'titulo', s.titulo,
    'mensagem', s.mensagem,
    'imoveis', s.imoveis,
    'criado', s.criado,
    'autor', jsonb_build_object(
      'nome', p.nome, 'perfil', p.perfil, 'creci', p.creci, 'creci_uf', p.creci_uf,
      'whatsapp', p.whatsapp, 'foto_path', p.foto_path, 'slug', p.slug,
      'verificado', coalesce(p.selo_verde, false)))
  from selecoes s join perfis p on p.user_id = s.user_id
  where s.codigo = p_codigo and p_codigo ~ '^[a-z0-9]{6,20}$'
$$;
revoke all on function public.selecao_publica(text) from public;
grant execute on function public.selecao_publica(text) to anon, authenticated;
