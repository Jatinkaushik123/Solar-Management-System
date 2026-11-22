create table solar_private.checkout_attempts (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null references solar_private.quotes,
    choice text not null check (choice in ('advance','full')),
    amount_paise bigint not null check (amount_paise>0),
    currency text not null default 'INR' check (currency='INR'),
    state text not null default 'creating' check (state in ('creating','ready','uncertain','captured','review','superseded')),
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
    key_id text,
    provider_order_id text unique,
    unique(id,quote_id)
);
create index checkout_by_quote on solar_private.checkout_attempts(quote_id,created_at desc,id);
create table solar_private.checkout_keys (
    actor_id uuid not null references public.solar_profiles,
    request_key uuid not null,
    attempt_id uuid not null references solar_private.checkout_attempts,
    operation text not null default 'checkout',
    fingerprint text,
    primary key(actor_id,request_key)
);
create table solar_private.stock_holds (
    attempt_id uuid not null references solar_private.checkout_attempts,
    item_id text not null references solar_private.stock_items,
    quantity integer not null check(quantity>0),
    primary key(attempt_id,item_id)
);
create index stock_holds_item on solar_private.stock_holds(item_id);
create table solar_private.sales_orders (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null unique references solar_private.quotes,
    confirmed_at timestamptz not null default clock_timestamp()
);
create table solar_private.order_reservations (
    order_id uuid not null references solar_private.sales_orders,
    item_id text not null references solar_private.stock_items,
    quantity integer not null check(quantity>0),
    primary key(order_id,item_id)
);
create index order_reservations_item on solar_private.order_reservations(item_id);
create table solar_private.pick_lists (
    id uuid primary key default gen_random_uuid(), order_id uuid not null unique references solar_private.sales_orders,
    state text not null default 'ready_to_pick' check(state='ready_to_pick')
);
create table solar_private.installation_work_orders (
    id uuid primary key default gen_random_uuid(), order_id uuid not null unique references solar_private.sales_orders,
    state text not null default 'ready_to_schedule' check(state='ready_to_schedule')
);
create table solar_private.payment_receipts (
    id uuid primary key default gen_random_uuid(),
    provider_payment_id text not null unique,
    attempt_id uuid not null unique references solar_private.checkout_attempts,
    amount_paise bigint not null check(amount_paise>0),
    currency text not null check(currency='INR'),
    credited_at timestamptz not null default clock_timestamp()
);
create table solar_private.payment_reviews (
    id uuid primary key default gen_random_uuid(),
    attempt_id uuid not null references solar_private.checkout_attempts,
    payment_id text not null,
    reason text not null,
    observed jsonb not null,
    opened_at timestamptz not null default clock_timestamp(),
    resolved_at timestamptz,
    unique(attempt_id,payment_id,reason)
);
create index open_reviews on solar_private.payment_reviews(opened_at) where resolved_at is null;
alter table solar_private.sales_orders add column confirmation_receipt_id uuid not null unique references solar_private.payment_receipts;
alter table solar_private.stock_items rename column available to on_hand;
create view solar_private.stock_availability with(security_invoker=true) as
    select s.item_id,s.name,s.suggested_unit_paise,s.on_hand,
           h.qty as held,r.qty as reserved,(s.on_hand-h.qty-r.qty)::integer as available
    from solar_private.stock_items s
    cross join lateral (select coalesce(sum(l.quantity),0)::integer as qty from solar_private.stock_holds l
        join solar_private.checkout_attempts c on c.id=l.attempt_id where l.item_id=s.item_id
        and c.state in ('creating','ready','uncertain') and c.expires_at>clock_timestamp()) h
    cross join lateral (select coalesce(sum(l.quantity),0)::integer as qty from solar_private.order_reservations l where l.item_id=s.item_id) r;
grant usage on schema solar_private to service_role;
do $$ declare rel text;
begin
    foreach rel in array array['checkout_attempts','checkout_keys','stock_holds','sales_orders','order_reservations','pick_lists',
                              'installation_work_orders','payment_receipts','payment_reviews'] loop
        execute format('alter table solar_private.%I enable row level security',rel);
        execute format('revoke all on solar_private.%I from public, anon, authenticated, service_role',rel);
    end loop;
end $$;
revoke all on solar_private.stock_availability from public,anon,authenticated,service_role;

create function solar_private.order_lines(q solar_private.quotes)
returns table(item_id text,quantity integer) language sql immutable set search_path='' as $$
    select l.item_id,l.quantity from jsonb_to_recordset(q.lines) as l(item_id text,quantity integer) order by l.item_id
$$;
create function solar_private.lock_equipment(q solar_private.quotes) returns void
language plpgsql set search_path='' as $$
begin
    perform s.item_id from solar_private.stock_items s join solar_private.order_lines(q) l using(item_id)
    order by s.item_id for update of s;
end $$;
create function solar_private.kit_available(q solar_private.quotes) returns boolean
language sql volatile set search_path='' as $$
    select count(*)>0 and bool_and(coalesce(s.available>=l.quantity,false)) from solar_private.order_lines(q) l
        left join solar_private.stock_availability s using(item_id)
$$;
create function solar_private.amount_received(target uuid) returns bigint language sql stable set search_path='' as $$
    select coalesce(sum(r.amount_paise),0)::bigint from solar_private.payment_receipts r
        join solar_private.checkout_attempts c on c.id=r.attempt_id where c.quote_id=target
$$;
create function solar_private.attempt_view(c solar_private.checkout_attempts) returns jsonb
language sql volatile set search_path='' as $$
    select jsonb_build_object('id',c.id,'quote_id',c.quote_id,'choice',c.choice,'amount_paise',c.amount_paise,'currency',c.currency,
        'expires_at',c.expires_at,'state',case when c.state in('ready','creating','uncertain') and c.expires_at<=clock_timestamp()
            then 'expired' else c.state end,'provider_order_id',c.provider_order_id,'key_id',c.key_id)
$$;
create function solar_private.checkout_begin(actor uuid,target uuid,choice text,k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q solar_private.quotes; c solar_private.checkout_attempts; paid bigint; amount bigint; new_attempt boolean:=false;
begin
    if k is null or choice is null or choice not in('advance','full') then raise sqlstate 'PT400' using message='invalid_checkout'; end if;
    select v.* into q from solar_private.quotes v join solar_private.enquiries e on e.id=v.enquiry_id
        where v.id=target and e.customer_id=actor and v.state='accepted' for update of v;
    if not found then raise sqlstate 'PT404' using message='quote_not_found'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||k::text,0));
    select a.* into c from solar_private.checkout_keys x join solar_private.checkout_attempts a on a.id=x.attempt_id
        where x.actor_id=actor and x.request_key=k;
    if found then
        if c.quote_id<>target or c.choice<>choice or exists(select 1 from solar_private.checkout_keys x where x.actor_id=actor and x.request_key=k and x.operation<>'checkout') then
            raise sqlstate 'PT409' using message='idempotency_conflict'; end if;
        return solar_private.attempt_view(c)||'{"create_order":false}'::jsonb;
    end if;
    if exists(select 1 from solar_private.payment_reviews r join solar_private.checkout_attempts a on a.id=r.attempt_id
            where a.quote_id=q.id and r.resolved_at is null) then raise sqlstate 'PT409' using message='payment_under_review'; end if;
    paid:=solar_private.amount_received(q.id);
    amount:=case when choice='full' then q.total_paise-paid else q.advance_paise end;
    if paid>=q.total_paise or (choice='advance' and paid>0) then raise sqlstate 'PT409' using message='choice_unavailable'; end if;
    select * into c from solar_private.checkout_attempts a where a.quote_id=q.id and
        (a.state in ('creating','uncertain') or (a.state='ready' and a.expires_at>clock_timestamp()))
        order by a.created_at desc limit 1;
    if found then
        if c.choice<>choice then raise sqlstate 'PT409' using message='open_checkout_exists'; end if;
    else
        if paid=0 then
            perform solar_private.lock_equipment(q);
            if not solar_private.kit_available(q) then raise sqlstate 'PT409' using message='stock_shortage'; end if;
        end if;
        insert into solar_private.checkout_attempts(quote_id,choice,amount_paise) values(q.id,choice,amount) returning * into c;
        if paid=0 then
            insert into solar_private.stock_holds select c.id,l.item_id,l.quantity from solar_private.order_lines(q) l;
        end if;
        new_attempt:=true;
    end if;
    insert into solar_private.checkout_keys(actor_id,request_key,attempt_id) values(actor,k,c.id);
    return solar_private.attempt_view(c)||jsonb_build_object('create_order',new_attempt);
end $$;
create function solar_private.checkout_bind(target uuid,provider_order text,public_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c solar_private.checkout_attempts;
begin
    select * into strict c from solar_private.checkout_attempts where id=target for update;
    if provider_order is null or provider_order !~ '^order_[A-Za-z0-9]{1,100}$' or public_key is null or public_key !~ '^rzp_test_[A-Za-z0-9]{1,100}$' then
        raise sqlstate 'PT400' using message='invalid_gateway_order'; end if;
    if c.provider_order_id is null and c.state in ('creating','uncertain','superseded') then
        update solar_private.checkout_attempts set provider_order_id=provider_order,key_id=public_key,
            state=case when state='superseded' then state else 'ready' end where id=target returning * into c;
    elsif (c.provider_order_id,c.key_id) is distinct from (provider_order,public_key) then raise sqlstate 'PT409' using message='gateway_order_conflict'; end if;
    return solar_private.attempt_view(c);
end $$;
create function solar_private.checkout_uncertain(target uuid) returns jsonb
language sql security definer set search_path='' as $$
    update solar_private.checkout_attempts set state='uncertain' where id=target and state='creating' returning solar_private.attempt_view(checkout_attempts)
$$;
revoke all on function solar_private.order_lines(solar_private.quotes),solar_private.lock_equipment(solar_private.quotes),
    solar_private.kit_available(solar_private.quotes),solar_private.amount_received(uuid),solar_private.attempt_view(solar_private.checkout_attempts)
    from public,anon,authenticated,service_role;
create function public.solar_checkout_begin(actor uuid, target uuid, choice text, k uuid) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.checkout_begin($1,$2,$3,$4) $$;
revoke all on function public.solar_checkout_begin(uuid,uuid,text,uuid), solar_private.checkout_begin(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.solar_checkout_begin(uuid,uuid,text,uuid), solar_private.checkout_begin(uuid,uuid,text,uuid) to service_role;
create function public.solar_checkout_bind(target uuid, provider_order text, public_key text) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.checkout_bind($1,$2,$3) $$;
revoke all on function public.solar_checkout_bind(uuid,text,text), solar_private.checkout_bind(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.solar_checkout_bind(uuid,text,text), solar_private.checkout_bind(uuid,text,text) to service_role;
create function public.solar_checkout_uncertain(target uuid) returns jsonb
language sql security invoker set search_path='' as $$ select solar_private.checkout_uncertain($1) $$;
revoke all on function public.solar_checkout_uncertain(uuid), solar_private.checkout_uncertain(uuid) from public, anon, authenticated, service_role;
grant execute on function public.solar_checkout_uncertain(uuid), solar_private.checkout_uncertain(uuid) to service_role;
create or replace function solar_private.check_inventory(e solar_private.enquiries,actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare c solar_private.stock_checks; quote_id uuid; available_lines jsonb; sufficient boolean;
begin
    select * into c from solar_private.stock_checks where enquiry_id=e.id and revision=e.revision and outcome='approved';
    if found then
        select id into quote_id from solar_private.quotes where enquiry_id=e.id and design_revision=e.revision order by revision desc limit 1;
    else
        if e.state not in ('technical_approved','shortage') then raise sqlstate 'PT409' using message='technical_approval_required'; end if;
        select bool_and(s.available>=l.quantity), jsonb_agg(jsonb_build_object('item_id',l.item_id,
            'required',l.quantity,'available',s.available,'shortfall',greatest(0,l.quantity-s.available)) order by l.item_id)
        into sufficient,available_lines from solar_private.equipment_lines l join solar_private.stock_availability s using(item_id)
        where l.enquiry_id=e.id and l.revision=e.revision;
        if sufficient is null then raise sqlstate 'PT409' using message='technical_approval_required'; end if;
        insert into solar_private.stock_checks(enquiry_id,revision,actor_id,outcome,lines)
        values(e.id,e.revision,actor,case when sufficient then 'approved' else 'shortage' end,available_lines) returning * into c;
        if sufficient then quote_id:=solar_private.make_draft(e,c.id); end if;
        update solar_private.enquiries set state=case when sufficient then 'draft' else 'shortage' end where id=e.id;
        perform solar_private.event(e,actor,'inventory_'||c.outcome,jsonb_build_object('check_id',c.id));
    end if;
    return to_jsonb(c)||jsonb_build_object('quote_id',quote_id);
end $$;
create or replace function solar_private.demo_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text;
begin
    select role into role_name from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if role_name not in ('admin','technician','inventory') then raise sqlstate 'PT403' using message='forbidden'; end if;
    return (select jsonb_agg(to_jsonb(s) order by item_id) from solar_private.stock_availability s);
end $$;
