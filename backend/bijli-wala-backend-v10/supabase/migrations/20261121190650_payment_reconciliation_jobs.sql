alter table solar_private.payment_observations add column lookup_count integer not null default 0,
    add column next_lookup_at timestamptz not null default clock_timestamp()+interval '1 minute';
create index payment_lookups_due on solar_private.payment_observations(next_lookup_at)
    where status not in ('captured','failed','refunded');
create table solar_private.worker_credentials (
    name text primary key, token_hash text not null, endpoint text, vault_id uuid
);
alter table solar_private.worker_credentials enable row level security;
revoke all on solar_private.worker_credentials from public,anon,authenticated,service_role;

create function solar_private.claim_lookups(ticket text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
    if not exists(select 1 from solar_private.worker_credentials w where name='payment_lookup' and
        w.token_hash=encode(extensions.digest(ticket,'sha256'),'hex')) then raise sqlstate 'PT403' using message='forbidden'; end if;
    with due as (
        select o.attempt_id,o.payment_id from solar_private.payment_observations o
        where o.status not in ('captured','failed','refunded') and o.next_lookup_at<=clock_timestamp()
        order by o.next_lookup_at,o.attempt_id,o.payment_id limit 5 for update skip locked
    ), claimed as (
        update solar_private.payment_observations o set lookup_count=o.lookup_count+1,
            next_lookup_at=clock_timestamp()+make_interval(mins=>least(30,1<<least(o.lookup_count+1,5)))
        from due where o.attempt_id=due.attempt_id and o.payment_id=due.payment_id
        returning o.attempt_id,o.payment_id
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into jobs from claimed;
    return jobs;
end $$;

-- Registration runs once per hosted environment. The scheduler sends requests only
-- when a known payment needs a provider lookup. Its credential never leaves Vault in a migration or log result.
create function solar_private.configure_payment_worker(url text) returns void
language plpgsql set search_path='' as $$
declare token text; secret_id uuid;
begin
    if url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/api/v1/jobs/payment-reconciliation$' then raise exception 'Invalid worker URL'; end if;
    if exists(select 1 from solar_private.worker_credentials where name='payment_lookup') then
        update solar_private.worker_credentials set endpoint=url where name='payment_lookup'; return;
    end if;
    token:=encode(extensions.gen_random_bytes(32),'hex');
    select vault.create_secret(token,'solar_payment_lookup_token') into secret_id;
    insert into solar_private.worker_credentials(name,token_hash,endpoint,vault_id)
        values('payment_lookup',encode(extensions.digest(token,'sha256'),'hex'),url,secret_id);
end $$;
create function solar_private.dispatch_payment_lookups() returns void
language plpgsql set search_path='' as $$
declare endpoint text; token text;
begin
    if not exists(select 1 from solar_private.payment_observations where status not in ('captured','failed','refunded')
        and next_lookup_at<=clock_timestamp()) then return; end if;
    select w.endpoint,s.decrypted_secret into endpoint,token from solar_private.worker_credentials w
        join vault.decrypted_secrets s on s.id=w.vault_id where w.name='payment_lookup';
    if token is null then return; end if;
    perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),
        body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function solar_private.configure_payment_worker(text),solar_private.dispatch_payment_lookups() from public,anon,authenticated,service_role;
do $schedule$
begin
    -- Plain PostgreSQL test clusters run the claim operation directly.
    if to_regnamespace('vault') is not null then
        create extension if not exists pg_cron;
        create extension if not exists pg_net with schema extensions;
        perform cron.schedule('solar-payment-lookups','* * * * *','select solar_private.dispatch_payment_lookups()');
    end if;
end $schedule$;
create function public.solar_claim_lookups(ticket text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.claim_lookups($1) $$;
revoke all on function public.solar_claim_lookups(text), solar_private.claim_lookups(text) from public, anon, authenticated, service_role;
grant execute on function public.solar_claim_lookups(text), solar_private.claim_lookups(text) to service_role;
