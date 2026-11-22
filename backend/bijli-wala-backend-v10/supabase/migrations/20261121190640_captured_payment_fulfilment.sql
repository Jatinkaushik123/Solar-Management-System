create table solar_private.gateway_events (
    event_id text primary key, facts jsonb not null, observed_at timestamptz not null default clock_timestamp()
);
create table solar_private.payment_observations (
    attempt_id uuid not null references solar_private.checkout_attempts,
    payment_id text not null, status text not null, updated_at timestamptz not null default clock_timestamp(),
    primary key(attempt_id,payment_id)
);
alter table solar_private.gateway_events enable row level security;
alter table solar_private.payment_observations enable row level security;
revoke all on solar_private.gateway_events,solar_private.payment_observations from public,anon,authenticated,service_role;

create function solar_private.payment_read(actor uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q solar_private.quotes; c solar_private.checkout_attempts; ord jsonb; receipts jsonb; paid bigint;
    review boolean; phase text; choices text[];
begin
    select v.* into q from solar_private.quotes v join solar_private.enquiries e on e.id=v.enquiry_id
        where v.id=target and e.customer_id=actor and v.state='accepted';
    if not found then raise sqlstate 'PT404' using message='quote_not_found'; end if;
    select * into c from solar_private.checkout_attempts where quote_id=q.id order by created_at desc,id desc limit 1;
    select to_jsonb(o)||jsonb_build_object('pick_list_id',p.id,'work_order_id',w.id) into ord
        from solar_private.sales_orders o join solar_private.pick_lists p on p.order_id=o.id
        join solar_private.installation_work_orders w on w.order_id=o.id where o.quote_id=q.id;
    select coalesce(sum(r.amount_paise),0),coalesce(jsonb_agg(to_jsonb(r) order by r.credited_at,r.id),'[]')
        into paid,receipts from solar_private.payment_receipts r join solar_private.checkout_attempts a on a.id=r.attempt_id where a.quote_id=q.id;
    select exists(select 1 from solar_private.payment_reviews r join solar_private.checkout_attempts a on a.id=r.attempt_id
        where a.quote_id=q.id and r.resolved_at is null) into review;
    phase:=case when review or c.state='uncertain' or (c.state='creating' and c.created_at<now()-interval '1 minute') then 'under_review'
        when c.state in('creating','ready') and c.expires_at>clock_timestamp() then 'payment_pending'
        when ord is not null then 'confirmed' else 'checkout_available' end;
    choices:=case when phase='under_review' or paid=q.total_paise then array[]::text[]
        when paid>0 or q.total_paise=q.advance_paise then array['full'] else array['advance','full'] end;
    return jsonb_build_object('quote_id',q.id,'state',phase,'total_paise',q.total_paise,'advance_paise',q.advance_paise,
        'currency',q.currency,'collected_paise',paid,'remaining_paise',q.total_paise-paid,'choices',choices,
        'attempt',case when c.id is not null then solar_private.attempt_view(c) end,'receipts',receipts,'order',ord);
end $$;
create function solar_private.payment_review(target uuid, pid text, why text, facts jsonb) returns void
language sql set search_path='' as $$
    insert into solar_private.payment_reviews(attempt_id,payment_id,reason,observed) values(target,pid,why,facts)
    on conflict(attempt_id,payment_id,reason) do nothing
$$;
create function solar_private.fulfil_capture(q solar_private.quotes,c solar_private.checkout_attempts,pid text) returns void
language plpgsql set search_path='' as $$
declare order_id uuid;
begin
    if exists(select 1 from solar_private.sales_orders o where o.quote_id=q.id) then return; end if;
    perform solar_private.lock_equipment(q);
    if not solar_private.kit_available(q) then
        perform solar_private.payment_review(c.id,pid,'stock_shortage',jsonb_build_object('amount_paise',c.amount_paise,'currency',c.currency));
        return;
    end if;
    insert into solar_private.sales_orders(quote_id,confirmation_receipt_id)
        select q.id,r.id from solar_private.payment_receipts r where r.attempt_id=c.id and r.provider_payment_id=pid
        returning id into strict order_id;
    insert into solar_private.order_reservations select order_id,l.item_id,l.quantity from solar_private.order_lines(q) l;
    insert into solar_private.pick_lists(order_id) values(order_id);
    insert into solar_private.installation_work_orders(order_id) values(order_id);
    update solar_private.payment_reviews set resolved_at=clock_timestamp()
    where attempt_id=c.id and payment_id=pid and reason='stock_shortage' and resolved_at is null;
end $$;

create function solar_private.record_gateway_event(eid text, facts jsonb) returns void
language plpgsql set search_path='' as $$
begin
    if eid is null then return; end if;
    if char_length(eid) not between 1 and 200 then raise sqlstate 'PT400' using message='invalid_event'; end if;
    insert into solar_private.gateway_events(event_id,facts) values(eid,facts) on conflict do nothing;
    if not found and not exists(select 1 from solar_private.gateway_events g where g.event_id=eid and g.facts=record_gateway_event.facts) then
        raise sqlstate 'PT409' using message='event_conflict'; end if;
end $$;
create function solar_private.ignored_event(event_id text,event_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
    perform solar_private.record_gateway_event(event_id,jsonb_build_object('ignored',event_type));
    return '{"received":true}'::jsonb;
end $$;
create function solar_private.expect_payment(target uuid,payment_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
    if payment_id is null or payment_id !~ '^pay_[A-Za-z0-9]{1,100}$' then raise sqlstate 'PT400' using message='invalid_payment_id'; end if;
    insert into solar_private.payment_observations(attempt_id,payment_id,status) values(target,payment_id,'callback_verified')
        on conflict do nothing;
    return '{"recorded":true}'::jsonb;
end $$;

create function solar_private.payment_observe(target uuid,event_id text,snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid text:=snapshot->>'paymentId'; oid text:=snapshot->>'orderId'; observed_status text:=snapshot->>'status';
    c solar_private.checkout_attempts; q solar_private.quotes; owner_id uuid; prior solar_private.payment_receipts;
    paid bigint; why text; amount bigint;
begin
    perform solar_private.amount(snapshot,'amountPaise',0,9007199254740991);
    amount:=(snapshot->>'amountPaise')::bigint;
    if pid is null or pid !~ '^pay_[A-Za-z0-9]{1,100}$' or nullif(snapshot->>'currency','') is null or nullif(observed_status,'') is null then
        raise sqlstate 'PT400' using message='invalid_payment_snapshot'; end if;
    perform pg_advisory_xact_lock(hashtextextended('provider-payment:'||pid,0));
    select a.* into c from solar_private.checkout_attempts a where
        (target is not null and a.id=target) or (target is null and a.provider_order_id=oid);
    if not found or c.provider_order_id is null then raise sqlstate 'PT503' using message='gateway_order_not_linked'; end if;
    select * into strict q from solar_private.quotes where id=c.quote_id for update;
    select * into strict c from solar_private.checkout_attempts where id=c.id for update;
    select customer_id into strict owner_id from solar_private.enquiries where id=q.enquiry_id;
    perform solar_private.record_gateway_event(event_id,snapshot);
    insert into solar_private.payment_observations as o(attempt_id,payment_id,status) values(c.id,pid,observed_status)
        on conflict(attempt_id,payment_id) do update set status=excluded.status,updated_at=clock_timestamp()
        where o.status<>'captured' and (o.status<>'failed' or excluded.status='captured');
    if observed_status<>'captured' then return solar_private.payment_read(owner_id,q.id); end if;
    select * into prior from solar_private.payment_receipts where provider_payment_id=pid;
    paid:=solar_private.amount_received(q.id);
    why:=case
        when oid is distinct from c.provider_order_id then 'order_mismatch'
        when snapshot->>'currency' is distinct from c.currency then 'currency_mismatch'
        when amount<>c.amount_paise then 'amount_mismatch'
        when prior.id is not null and prior.attempt_id<>c.id then 'payment_already_applied'
        when prior.id is null and (exists(select 1 from solar_private.payment_receipts where attempt_id=c.id)
             or amount>q.total_paise-paid or (c.choice='advance' and paid>0)) then 'excess_capture'
        end;
    if why is not null then
        perform solar_private.payment_review(c.id,pid,why,snapshot);
        update solar_private.checkout_attempts set state='review' where id=c.id and state<>'captured';
    elsif prior.id is not null then
        -- A verified recheck can fulfil a credited late capture after replenishment.
        perform solar_private.fulfil_capture(q,c,pid);
    else
        insert into solar_private.payment_receipts(provider_payment_id,attempt_id,amount_paise,currency)
            values(pid,c.id,amount,c.currency);
        update solar_private.checkout_attempts set state='captured' where id=c.id;
        update solar_private.checkout_attempts set state='superseded' where quote_id=q.id and id<>c.id and state in('creating','uncertain','ready');
        perform solar_private.fulfil_capture(q,c,pid);
    end if;
    return solar_private.payment_read(owner_id,q.id);
end $$;
revoke all on function solar_private.record_gateway_event(text,jsonb),solar_private.payment_review(uuid,text,text,jsonb),
    solar_private.fulfil_capture(solar_private.quotes,solar_private.checkout_attempts,text) from public,anon,authenticated,service_role;
create function public.solar_payment_read(actor uuid, target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select solar_private.payment_read($1,$2) $$;
revoke all on function public.solar_payment_read(uuid,uuid), solar_private.payment_read(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.solar_payment_read(uuid,uuid), solar_private.payment_read(uuid,uuid) to service_role;
create function public.solar_payment_observe(target uuid, event_id text, snapshot jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.payment_observe($1,$2,$3) $$;
revoke all on function public.solar_payment_observe(uuid,text,jsonb), solar_private.payment_observe(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.solar_payment_observe(uuid,text,jsonb), solar_private.payment_observe(uuid,text,jsonb) to service_role;
create function public.solar_ignored_event(event_id text, event_type text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.ignored_event($1,$2) $$;
revoke all on function public.solar_ignored_event(text,text), solar_private.ignored_event(text,text) from public, anon, authenticated, service_role;
grant execute on function public.solar_ignored_event(text,text), solar_private.ignored_event(text,text) to service_role;
create function public.solar_expect_payment(target uuid, payment_id text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.expect_payment($1,$2) $$;
revoke all on function public.solar_expect_payment(uuid,text), solar_private.expect_payment(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.solar_expect_payment(uuid,text), solar_private.expect_payment(uuid,text) to service_role;
create function solar_private.checkout_access(actor uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c solar_private.checkout_attempts;
begin
    select a.* into c from solar_private.checkout_attempts a join solar_private.quotes q on q.id=a.quote_id
        join solar_private.enquiries e on e.id=q.enquiry_id where a.id=target and
        (e.customer_id=actor or exists(select 1 from solar_private.staff_assignments s join auth.users u on u.id=s.user_id
            where s.user_id=actor and s.role='admin' and (u.banned_until is null or u.banned_until<=now())));
    if not found then raise sqlstate 'PT404' using message='checkout_not_found'; end if;
    return solar_private.attempt_view(c);
end $$;
create function solar_private.payment_command_key(actor uuid,target uuid,operation text,k uuid,fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
    perform solar_private.checkout_access(actor,target);
    if operation not in ('verify','reconcile') or k is null or fingerprint is null then raise sqlstate 'PT400' using message='invalid_command'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||k::text,0));
    insert into solar_private.checkout_keys(actor_id,request_key,attempt_id,operation,fingerprint)
        values(actor,k,target,operation,fingerprint) on conflict do nothing;
    if not found and not exists(select 1 from solar_private.checkout_keys x where x.actor_id=actor and x.request_key=k
        and x.attempt_id=target and x.operation=payment_command_key.operation and x.fingerprint=payment_command_key.fingerprint) then
        raise sqlstate 'PT409' using message='idempotency_conflict'; end if;
    return '{"recorded":true}'::jsonb;
end $$;
create function solar_private.reconciliation_queue(actor uuid,after_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
    if not exists(select 1 from solar_private.staff_assignments s join auth.users u on u.id=s.user_id where s.user_id=actor and s.role='admin'
        and (u.banned_until is null or u.banned_until<=now())) then raise sqlstate 'PT403' using message='forbidden'; end if;
    return (select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from (
        select c.id,c.quote_id,c.provider_order_id,c.amount_paise,c.currency,c.state,c.created_at,c.expires_at,
            p.observations,r.reviews from solar_private.checkout_attempts c
        cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('payment_id',o.payment_id,'status',o.status) order by o.payment_id),'[]') observations
            from solar_private.payment_observations o where o.attempt_id=c.id) p
        cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('reason',r.reason,'payment_id',r.payment_id,'observed',r.observed) order by r.opened_at),'[]') reviews
            from solar_private.payment_reviews r where r.attempt_id=c.id and r.resolved_at is null) r
        where (after_id is null or c.id>after_id) and (r.reviews<>'[]'::jsonb or c.state='uncertain'
            or (c.state='creating' and c.created_at<now()-interval '1 minute')
            or (c.state='ready' and p.observations<>'[]'::jsonb))
        order by c.id limit 100) v);
end $$;
create function public.solar_checkout_access(actor uuid, target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select solar_private.checkout_access($1,$2) $$;
revoke all on function public.solar_checkout_access(uuid,uuid), solar_private.checkout_access(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.solar_checkout_access(uuid,uuid), solar_private.checkout_access(uuid,uuid) to service_role;
create function public.solar_payment_command_key(actor uuid, target uuid, operation text, k uuid, fingerprint text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.payment_command_key($1,$2,$3,$4,$5) $$;
revoke all on function public.solar_payment_command_key(uuid,uuid,text,uuid,text), solar_private.payment_command_key(uuid,uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.solar_payment_command_key(uuid,uuid,text,uuid,text), solar_private.payment_command_key(uuid,uuid,text,uuid,text) to service_role;
create function public.solar_reconciliation_queue(actor uuid, after_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select solar_private.reconciliation_queue($1,$2) $$;
revoke all on function public.solar_reconciliation_queue(uuid,uuid), solar_private.reconciliation_queue(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.solar_reconciliation_queue(uuid,uuid), solar_private.reconciliation_queue(uuid,uuid) to service_role;
