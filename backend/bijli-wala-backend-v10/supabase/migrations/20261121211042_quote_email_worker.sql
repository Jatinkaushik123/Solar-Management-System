alter table solar_private.quote_emails
    add column next_attempt_at timestamptz,
    add column first_attempt_at timestamptz,
    add column attempt_count integer not null default 0 check (attempt_count between 0 and 8),
    add column lease_id uuid,
    add column lease_until timestamptz,
    add column provider_request jsonb,
    add column provider_message_id uuid unique,
    add column sent_at timestamptz,
    add column attention_at timestamptz,
    add column last_error text,
    add check ((lease_id is null)=(lease_until is null) and (provider_message_id is null)=(sent_at is null));
-- Historical rows stay pending for review. Only newly issued quotes are enrolled.
alter table solar_private.quote_emails alter column next_attempt_at set default clock_timestamp();
create index quote_emails_due on solar_private.quote_emails(next_attempt_at,id)
    where status='pending' and attention_at is null and next_attempt_at is not null;

create or replace function solar_private.quote_view(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; delivery jsonb;
begin
    result:=solar_private.quote_base(target);
    if (select role from solar_private.actor()) in ('admin','sales') then
        select jsonb_build_object('id',id,'status',status,'queued_at',queued_at,'recipient',recipient,
            'delivery_state',case when status='sent' then 'provider_accepted' when status='cancelled' then 'cancelled'
                when attention_at is not null then 'needs_attention' when lease_until>now() then 'sending'
                when attempt_count>0 then 'retrying' else 'pending' end,
            'attempt_count',attempt_count,'sent_at',sent_at,'last_error',last_error)
        into delivery from solar_private.quote_emails where quote_id=target;
        result:=result||jsonb_build_object('delivery',delivery);
    end if;
    return result;
end $$;

create function solar_private.deliverable_quote_recipient(address text) returns boolean
language sql immutable set search_path='' as $$
    select address ~ '^[^[:space:]@]+@[^[:space:]@.]+([.][^[:space:]@.]+)+$'
        and split_part(lower(address),'@',2) !~ '(^|[.])(test|invalid|example|localhost)$|(^|[.])example[.](com|net|org)$'
$$;
create function solar_private.require_quote_email_worker(ticket text) returns void
language plpgsql set search_path='' as $$
begin
    if ticket is null or ticket !~ '^[a-f0-9]{64}$' or not exists(
        select 1 from solar_private.worker_credentials w where w.name='quote_email' and
            w.token_hash=encode(extensions.digest(ticket,'sha256'),'hex')) then
        raise sqlstate 'PT403' using message='forbidden';
    end if;
end $$;
create function solar_private.claim_quote_emails(ticket text,ready boolean,recipient_filter text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); jobs jsonb;
begin
    perform solar_private.require_quote_email_worker(ticket);
    if ready is distinct from true then return '[]'; end if;
    update solar_private.quote_emails e set attention_at=stamp,lease_id=null,lease_until=null,
        next_attempt_at=null,last_error=coalesce(e.last_error,'retry_window_closed')
    where e.status='pending' and e.attention_at is null and e.first_attempt_at is not null
        and (e.lease_until is null or e.lease_until<=stamp)
        and (e.attempt_count>=8 or e.first_attempt_at+interval '23 hours'<=stamp);
    with due as (
        select e.id from solar_private.quote_emails e
        join solar_private.quotes q on q.id=e.quote_id join solar_private.enquiries n on n.id=q.enquiry_id
        join auth.users u on u.id=n.customer_id
        where e.status='pending' and e.attention_at is null and e.next_attempt_at<=stamp
            and (e.lease_until is null or e.lease_until<=stamp)
            and q.state in ('issued','accepted') and q.valid_until>=(stamp at time zone 'Asia/Kolkata')::date
            and u.email_confirmed_at is not null and lower(u.email)=lower(e.recipient)
            and (case when recipient_filter is null then solar_private.deliverable_quote_recipient(e.recipient)
                else lower(e.recipient)=lower(recipient_filter) end)
        order by e.next_attempt_at,e.id limit 3 for update of e skip locked
    ), claimed as (
        update solar_private.quote_emails e set lease_id=gen_random_uuid(),lease_until=stamp+interval '2 minutes',
            first_attempt_at=coalesce(e.first_attempt_at,stamp),attempt_count=e.attempt_count+1
        from due where e.id=due.id
        returning e.id,e.quote_id,e.recipient,e.message,e.provider_request,e.lease_id
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into jobs from claimed;
    return jobs;
end $$;

create function solar_private.prepare_quote_email(ticket text,target uuid,lease uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare frozen jsonb;
begin
    perform solar_private.require_quote_email_worker(ticket);
    update solar_private.quote_emails e set provider_request=coalesce(e.provider_request,payload)
    where e.id=target and e.lease_id=lease and e.status='pending' and e.lease_until>clock_timestamp()
        and jsonb_typeof(payload)='object' and payload->>'to'=e.recipient
    returning e.provider_request into frozen;
    return frozen;
end $$;
create function solar_private.finish_quote_email(ticket text,target uuid,lease uuid,outcome text,provider_id uuid,reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); e solar_private.quote_emails; retry_at timestamptz; attention boolean;
begin
    perform solar_private.require_quote_email_worker(ticket);
    select * into e from solar_private.quote_emails x where x.id=target and x.lease_id=lease and x.status='pending' for update;
    if not found then return false; end if;
    if outcome='accepted' and provider_id is not null and reason is null and e.provider_request is not null then
        update solar_private.quote_emails set status='sent',provider_message_id=provider_id,sent_at=stamp,
            next_attempt_at=null,lease_id=null,lease_until=null,last_error=null where id=target;
    elsif outcome in ('retry','terminal') and provider_id is null and reason in ('invalid_message','network_error',
        'provider_rate_limited','provider_unavailable','provider_idempotency_pending','provider_rejected','provider_idempotency_conflict') then
        retry_at:=stamp+make_interval(mins=>least(60,1<<e.attempt_count));
        attention:=outcome='terminal' or e.attempt_count>=8 or retry_at>=e.first_attempt_at+interval '23 hours';
        update solar_private.quote_emails set next_attempt_at=case when not attention then retry_at end,
            attention_at=case when attention then stamp end,lease_id=null,lease_until=null,last_error=reason where id=target;
    else
        raise sqlstate 'PT400' using message='invalid_delivery_result';
    end if;
    return true;
end $$;

create function solar_private.configure_quote_email_worker(url text) returns void
language plpgsql set search_path='' as $$
declare token text; secret_id uuid;
begin
    if url is null or url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/api/v1/jobs/quote-email$' then
        raise exception 'Invalid quote email worker URL';
    end if;
    if exists(select 1 from solar_private.worker_credentials where name='quote_email') then
        update solar_private.worker_credentials set endpoint=url where name='quote_email';
        return;
    end if;
    token:=encode(extensions.gen_random_bytes(32),'hex');
    select vault.create_secret(token,'solar_quote_email_token') into secret_id;
    insert into solar_private.worker_credentials(name,token_hash,endpoint,vault_id)
    values('quote_email',encode(extensions.digest(token,'sha256'),'hex'),url,secret_id);
end $$;
create function solar_private.dispatch_quote_emails() returns void
language plpgsql set search_path='' as $$
declare endpoint text; token text;
begin
    if not exists(select 1 from solar_private.quote_emails e
        join solar_private.quotes q on q.id=e.quote_id join solar_private.enquiries n on n.id=q.enquiry_id
        join auth.users u on u.id=n.customer_id
        where e.status='pending' and e.attention_at is null and e.next_attempt_at<=clock_timestamp()
            and (e.lease_until is null or e.lease_until<=clock_timestamp())
            and q.state in ('issued','accepted') and q.valid_until>=(now() at time zone 'Asia/Kolkata')::date
            and u.email_confirmed_at is not null and lower(u.email)=lower(e.recipient)
            and solar_private.deliverable_quote_recipient(e.recipient)) then return; end if;
    select w.endpoint,s.decrypted_secret into endpoint,token from solar_private.worker_credentials w
        join vault.decrypted_secrets s on s.id=w.vault_id where w.name='quote_email';
    if token is null then return; end if;
    perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),
        body:='{}'::jsonb,timeout_milliseconds:=40000);
end $$;
do $schedule$
begin
    if to_regnamespace('vault') is not null then
        perform cron.schedule('solar-quote-email','* * * * *','select solar_private.dispatch_quote_emails()');
    end if;
end $schedule$;

create function public.solar_quote_emails_claim(ticket text,ready boolean,recipient_filter text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.claim_quote_emails($1,$2,$3) $$;
create function public.solar_quote_email_prepare(ticket text,target uuid,lease uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.prepare_quote_email($1,$2,$3,$4) $$;
create function public.solar_quote_email_finish(ticket text,target uuid,lease uuid,outcome text,provider_id uuid,reason text) returns boolean
language sql security invoker set search_path='' as $$ select solar_private.finish_quote_email($1,$2,$3,$4,$5,$6) $$;
revoke all on function solar_private.deliverable_quote_recipient(text),solar_private.require_quote_email_worker(text),
    solar_private.configure_quote_email_worker(text),solar_private.dispatch_quote_emails(),
    public.solar_quote_emails_claim(text,boolean,text),solar_private.claim_quote_emails(text,boolean,text),
    public.solar_quote_email_prepare(text,uuid,uuid,jsonb),solar_private.prepare_quote_email(text,uuid,uuid,jsonb),
    public.solar_quote_email_finish(text,uuid,uuid,text,uuid,text),solar_private.finish_quote_email(text,uuid,uuid,text,uuid,text)
    from public,anon,authenticated,service_role;
grant execute on function public.solar_quote_emails_claim(text,boolean,text),solar_private.claim_quote_emails(text,boolean,text),
    public.solar_quote_email_prepare(text,uuid,uuid,jsonb),solar_private.prepare_quote_email(text,uuid,uuid,jsonb),
    public.solar_quote_email_finish(text,uuid,uuid,text,uuid,text),solar_private.finish_quote_email(text,uuid,uuid,text,uuid,text)
    to service_role;
