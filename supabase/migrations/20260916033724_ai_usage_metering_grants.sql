-- =============================================================================
-- Medição de IA: RPCs do servidor só em `anon`
-- =============================================================================
-- O servidor Next chama reserve_ai_usage e settle_ai_usage com a chave
-- publishable e sem sessão, ou seja, no papel `anon`. `authenticated` nunca
-- precisou delas: revogar diminui a superfície (mesma correção que o Indique e
-- ganhe fez em referral_program_antifraud). A chave `billing_server_key`
-- continua sendo a única coisa que libera a chamada.
revoke execute on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer) from authenticated;
revoke execute on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text) from authenticated;
