-- CRM interno de cada usuário (corretor, imobiliária, investidor, CEO e equipe): quadro Kanban
-- de tarefas e a agenda do Google de cada um (separada; ninguém vê a de outro).
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 2 and 160),
  detalhe text check (detalhe is null or char_length(detalhe) <= 2000),
  coluna text not null default 'a_fazer' check (coluna in ('a_fazer', 'fazendo', 'feito')),
  etiqueta text check (etiqueta is null or char_length(etiqueta) <= 30),
  prazo timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  ordem int not null default 0,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists tarefas_dono on public.tarefas (dono_id, coluna, ordem);
alter table public.tarefas enable row level security;
drop policy if exists tarefas_dono on public.tarefas;
create policy tarefas_dono on public.tarefas for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- Agenda do Google de cada usuário (ID ou e-mail da agenda), para mostrar no painel.
alter table public.perfis add column if not exists agenda_google text
  check (agenda_google is null or char_length(agenda_google) <= 200);
