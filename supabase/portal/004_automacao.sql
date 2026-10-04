-- Atualização automática dos imóveis: entram, mudam de preço e saem sozinhos.
-- A cada hora o banco chama as funções de importação:
--  * importar-caixa: lista oficial da Caixa por estado (pula o estado atualizado há menos de 6 h);
--  * importar-feed: cada parceiro com link de dados cadastrado em config_privado (feed_<fonte>_url).
-- Quando a lista de um estado não vem (proteção anti-robô da Caixa), nada é apagado: o erro fica
-- registrado em importacoes e o estado é tentado de novo na hora seguinte.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.disparar_importacoes() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_base text := 'https://pgkrhbyvinhffobniktg.supabase.co/functions/v1/';
  f record;
begin
  select valor into v_token from config_privado where chave = 'import_token';
  if v_token is null then return; end if;

  perform net.http_post(
    url := v_base || 'importar-caixa',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );

  for f in
    select substring(chave from '^feed_(.+)_url$') as fonte
    from config_privado where chave ~ '^feed_[a-z0-9_]+_url$' and coalesce(valor, '') <> ''
  loop
    perform net.http_post(
      url := v_base || 'importar-feed',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', v_token),
      body := jsonb_build_object('fonte', f.fonte, 'completo', true),
      timeout_milliseconds := 150000
    );
  end loop;
end $$;
revoke all on function public.disparar_importacoes() from public, anon, authenticated;

-- Anúncios pagos vencidos saem do feed dos portais.
create or replace function public.expirar_anuncios() returns void
language sql security definer set search_path = public as $$
  update anuncio_pedidos set status = 'expirado'
  where status = 'aprovado' and fim is not null and fim < now();
$$;
revoke all on function public.expirar_anuncios() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('importar-imoveis', 'expirar-anuncios');
select cron.schedule('importar-imoveis', '17 * * * *', 'select public.disparar_importacoes()');
select cron.schedule('expirar-anuncios', '5 3 * * *', 'select public.expirar_anuncios()');
