create table solar_private.service_tickets (
    id uuid primary key default gen_random_uuid(),
    serial_no bigint generated always as identity unique,
    order_id uuid not null references solar_private.sales_orders,
    serial text not null references solar_private.shipment_serials,
    warranty_id uuid references solar_private.warranties,
    warranty_starts_on date,
    warranty_expires_on date,
    coverage text not null check (coverage in ('covered','expired','uncovered')),
    fault text not null check (char_length(fault) between 1 and 2000),
    opened_by uuid not null references public.solar_profiles,
    opened_at timestamptz not null default clock_timestamp(),
    state text not null default 'open' check (state in ('open','assigned','awaiting_confirmation','closed')),
    technician_id uuid references public.solar_profiles,
    closed_by uuid references public.solar_profiles,
    closed_at timestamptz,
    check ((warranty_id is not null or coverage='uncovered') and (warranty_id is null)=(warranty_starts_on is null)
        and (warranty_id is null)=(warranty_expires_on is null)),
    check ((state='open')=(technician_id is null) and (state='closed')=(closed_at is not null)
        and (closed_at is null)=(closed_by is null)),
    unique (id,order_id,serial)
);
create unique index one_active_service_per_serial on solar_private.service_tickets(serial) where closed_at is null;
create index service_tickets_by_order on solar_private.service_tickets(order_id,id);
create index service_tickets_by_technician on solar_private.service_tickets(technician_id,id);
create index service_tickets_by_opening on solar_private.service_tickets(opened_at);
create table solar_private.service_events (
    id bigint generated always as identity primary key,
    ticket_id uuid not null references solar_private.service_tickets,
    actor_id uuid not null references public.solar_profiles,
    action text not null check (action in ('opened','assigned','resolved','confirmed','payment_recorded')),
    occurred_at timestamptz not null default clock_timestamp(),
    detail jsonb not null default '{}'
);
create index service_events_by_ticket on solar_private.service_events(ticket_id,id);

alter table solar_private.stock_movements add column service_ticket_id uuid references solar_private.service_tickets;
alter table solar_private.stock_movements
    drop constraint stock_movements_kind_check,
    drop constraint stock_movements_check,
    add check (kind in ('opening','receipt','dispatch','service_issue')),
    add check (
        (kind in ('opening','receipt') and delta>0 and shipment_id is null and service_ticket_id is null) or
        (kind='dispatch' and delta<0 and shipment_id is not null and service_ticket_id is null) or
        (kind='service_issue' and delta<0 and shipment_id is null and service_ticket_id is not null)
    ),
    add unique(service_ticket_id,item_id);

create table solar_private.service_resolutions (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null unique references solar_private.service_tickets,
    technician_id uuid not null references public.solar_profiles,
    diagnosis text not null,
    work_performed text not null,
    labour_charge_paise bigint not null check (labour_charge_paise between 0 and 1000000000),
    submission jsonb not null,
    finalized_at timestamptz not null default clock_timestamp()
);
create table solar_private.service_parts (
    movement_id uuid primary key references solar_private.stock_movements,
    unit_charge_paise bigint not null check (unit_charge_paise between 0 and 1000000000)
);
create table solar_private.service_replacements (
    ticket_id uuid primary key,
    order_id uuid not null,
    old_serial text not null unique references solar_private.shipment_serials,
    new_serial text not null unique references solar_private.shipment_serials,
    item_id text not null references solar_private.stock_items,
    warranty_id uuid references solar_private.warranties,
    installed_by uuid not null references public.solar_profiles,
    installed_at timestamptz not null default clock_timestamp(),
    foreign key (ticket_id,order_id,old_serial) references solar_private.service_tickets(id,order_id,serial),
    foreign key (old_serial,item_id) references solar_private.stock_serials(serial,item_id),
    foreign key (new_serial,item_id) references solar_private.stock_serials(serial,item_id),
    check (new_serial<>old_serial)
);
create index service_replacements_order on solar_private.service_replacements(order_id);
create table solar_private.service_invoices (
    id uuid primary key default gen_random_uuid(),
    serial_no bigint generated always as identity unique,
    ticket_id uuid not null unique references solar_private.service_tickets,
    resolution_id uuid not null unique references solar_private.service_resolutions,
    posted_by uuid not null references public.solar_profiles,
    posted_at timestamptz not null default clock_timestamp(),
    parts_paise bigint not null check (parts_paise>=0),
    labour_paise bigint not null check (labour_paise>=0),
    currency text not null default 'INR' check (currency='INR')
);
create index service_invoices_posted on solar_private.service_invoices(posted_at);
create table solar_private.service_collections (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references solar_private.service_invoices,
    amount_paise bigint not null check (amount_paise>0),
    method text not null check (method in ('bank','cash')),
    reference text not null,
    collected_on date not null,
    recorded_by uuid not null references public.solar_profiles,
    recorded_at timestamptz not null default clock_timestamp(),
    unique (method,reference)
);
create index service_collections_by_invoice on solar_private.service_collections(invoice_id);
create index service_collections_by_date on solar_private.service_collections(collected_on);

create table solar_private.material_rates (
    item_id text primary key references solar_private.stock_items,
    unit_cost_paise bigint not null check (unit_cost_paise between 0 and 1000000000),
    set_by uuid not null references public.solar_profiles,
    updated_at timestamptz not null default clock_timestamp()
);
create table solar_private.movement_costs (
    movement_id uuid primary key references solar_private.stock_movements,
    unit_cost_paise bigint not null check (unit_cost_paise between 0 and 1000000000),
    source text not null check (source in ('catalogue_rate','recorded_actual')),
    recorded_by uuid not null references public.solar_profiles,
    recorded_at timestamptz not null default clock_timestamp()
);
create index movement_costs_by_date on solar_private.movement_costs(recorded_at);
create table solar_private.technician_rates (
    technician_id uuid primary key references public.solar_profiles,
    hourly_paise bigint not null check (hourly_paise between 0 and 1000000000),
    set_by uuid not null references public.solar_profiles,
    updated_at timestamptz not null default clock_timestamp()
);
create table solar_private.technician_time (
    id uuid primary key default gen_random_uuid(),
    technician_id uuid not null references public.solar_profiles,
    service_resolution_id uuid unique references solar_private.service_resolutions,
    installation_report_id uuid unique references solar_private.installation_reports,
    worked_on date not null,
    minutes integer not null check (minutes between 1 and 10080),
    hourly_paise bigint not null check (hourly_paise between 0 and 1000000000),
    earned_paise bigint generated always as (round(minutes::numeric*hourly_paise/60)::bigint) stored,
    recorded_at timestamptz not null default clock_timestamp(),
    check ((service_resolution_id is null)<>(installation_report_id is null))
);
create index technician_time_by_actor on solar_private.technician_time(technician_id,id);
create index technician_time_by_date on solar_private.technician_time(worked_on);
create table solar_private.technician_payments (
    id uuid primary key default gen_random_uuid(),
    time_id uuid not null references solar_private.technician_time,
    amount_paise bigint not null check (amount_paise>0),
    reference text not null,
    paid_on date not null,
    recorded_by uuid not null references public.solar_profiles,
    recorded_at timestamptz not null default clock_timestamp(),
    unique (time_id,reference)
);
create index technician_payments_by_date on solar_private.technician_payments(paid_on);

do $$ declare rel text;
begin
    foreach rel in array array['service_tickets','service_events','service_resolutions','service_parts','service_replacements',
        'service_invoices','service_collections','material_rates','movement_costs','technician_rates','technician_time','technician_payments'] loop
        execute format('alter table solar_private.%I enable row level security',rel);
        execute format('revoke all on solar_private.%I from public,anon,authenticated,service_role',rel);
    end loop;
end $$;

create view solar_private.service_assets with(security_invoker=true) as
with origins as (
    select x.serial,x.item_id,p.id as order_id,p.customer_id,p.work_id,p.technician_id,p.delivered_at as available_since,
        w.id as warranty_id,null::text as previous_serial
    from solar_private.shipment_serials x join solar_private.stock_movements m on m.id=x.movement_id
    join solar_private.fulfilment_projects p on p.shipment_id=m.shipment_id
    left join solar_private.warranties w on w.serial=x.serial
    where p.delivered_at is not null
    union all
    select r.new_serial,r.item_id,p.id,p.customer_id,p.work_id,p.technician_id,r.installed_at,r.warranty_id,r.old_serial
    from solar_private.service_replacements r join solar_private.fulfilment_projects p on p.id=r.order_id
)
select o.*,w.starts_on,w.expires_on,w.term_months,n.new_serial as replacement_serial
from origins o left join solar_private.warranties w on w.id=o.warranty_id
left join solar_private.service_replacements n on n.old_serial=o.serial;
revoke all on solar_private.service_assets from public,anon,authenticated,service_role;

create function solar_private.india_date(ts timestamptz) returns date
language sql immutable set search_path='' as $$
    select (ts at time zone 'Asia/Kolkata')::date
$$;
create function solar_private.service_coverage(starts date,expires date,day date) returns text
language sql immutable set search_path='' as $$
    select case when starts is null or day<starts then 'uncovered' when day<expires then 'covered' else 'expired' end
$$;
create function solar_private.case_date(body jsonb,field text,first_day date) returns date
language plpgsql stable set search_path='' as $$
declare value text:=solar_private.text_field(body,field,10); day date;
begin
    if value !~ '^\d{4}-\d{2}-\d{2}$' then raise sqlstate 'PT400' using message='invalid_date'; end if;
    day:=value::date;
    if day<first_day or day>solar_private.india_date(now()) then raise sqlstate 'PT400' using message='invalid_date'; end if;
    return day;
end $$;

create function solar_private.capture_movement_cost() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    insert into solar_private.movement_costs(movement_id,unit_cost_paise,source,recorded_by)
    select new.id,rate.unit_cost_paise,'catalogue_rate',rate.set_by
    from solar_private.material_rates rate where rate.item_id=new.item_id;
    return new;
end $$;
create trigger capture_issue_cost after insert on solar_private.stock_movements
for each row when (new.kind in ('dispatch','service_issue')) execute function solar_private.capture_movement_cost();

create function solar_private.current_technician(tech uuid) returns boolean
language sql stable set search_path='' as $$
    select exists(select 1 from solar_private.staff_assignments s join auth.users u on u.id=s.user_id
        where s.user_id=tech and s.role='technician' and u.email_confirmed_at is not null and not u.is_anonymous
        and (u.banned_until is null or u.banned_until<=now()))
$$;

create function solar_private.ticket_visible(t solar_private.service_tickets,actor uuid,role_name text)
returns boolean language sql immutable set search_path='' as $$
    select coalesce(role_name='admin' or (role_name='customer' and t.opened_by=actor) or
        (role_name='technician' and t.technician_id=actor),false)
$$;
create function solar_private.ticket_summary(t solar_private.service_tickets) returns jsonb
language sql immutable set search_path='' as $$
    select to_jsonb(t)||jsonb_build_object('reference','SVC-'||t.serial_no,'order_reference','ORD-'||t.order_id,
        'currency','INR')
$$;
create function solar_private.ticket_detail(t solar_private.service_tickets) returns jsonb
language sql stable set search_path='' as $$
    select solar_private.ticket_summary(t)||jsonb_build_object(
        'customer_charge_paise',case when t.state in ('awaiting_confirmation','closed')
            then coalesce((select i.parts_paise+i.labour_paise from solar_private.service_invoices i where i.ticket_id=t.id),0) end,
        'resolution',(select jsonb_build_object('id',r.id,'diagnosis',r.diagnosis,'work_performed',r.work_performed,
            'technician_id',r.technician_id,'labour_charge_paise',r.labour_charge_paise,'finalized_at',r.finalized_at,
            'parts',(select coalesce(jsonb_agg(jsonb_build_object('item_id',m.item_id,'quantity',-m.delta,
                'unit_charge_paise',sp.unit_charge_paise,'serials',(select coalesce(jsonb_agg(x.serial),'[]')
                    from solar_private.shipment_serials x where x.movement_id=m.id)) order by m.item_id),'[]')
                from solar_private.stock_movements m join solar_private.service_parts sp on sp.movement_id=m.id
                where m.service_ticket_id=t.id))
            from solar_private.service_resolutions r where r.ticket_id=t.id),
        'replacement',(select jsonb_build_object('old_serial',r.old_serial,'new_serial',r.new_serial,'item_id',r.item_id,
            'installed_at',r.installed_at) from solar_private.service_replacements r where r.ticket_id=t.id),
        'invoice',(select jsonb_build_object('id',i.id,'reference','INV-'||i.serial_no,'posted_at',i.posted_at,
            'parts_paise',i.parts_paise,'labour_paise',i.labour_paise,'total_paise',i.parts_paise+i.labour_paise,
            'collected_paise',c.paid,'remaining_paise',i.parts_paise+i.labour_paise-c.paid,'currency',i.currency)
            from solar_private.service_invoices i cross join lateral (
                select coalesce(sum(v.amount_paise),0) paid from solar_private.service_collections v where v.invoice_id=i.id
            ) c where i.ticket_id=t.id),
        'history',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'actor_id',e.actor_id,
                'occurred_at',e.occurred_at,'detail',e.detail) order by e.id),'[]')
            from solar_private.service_events e where e.ticket_id=t.id)
    )
$$;
create function solar_private.service_event(target uuid,actor uuid,label text,detail jsonb default '{}') returns void
language sql set search_path='' as $$
    insert into solar_private.service_events(ticket_id,actor_id,action,detail) values($1,$2,$3,$4)
$$;
create function solar_private.open_service(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare serial_label text; problem text; asset solar_private.service_assets; t solar_private.service_tickets;
    opened timestamptz; coverage text;
begin
    perform solar_private.fields(body,array['serial','fault']);
    serial_label:=solar_private.text_field(body,'serial',96);
    if not solar_private.valid_serial(serial_label) then raise sqlstate 'PT400' using message='invalid_serial'; end if;
    problem:=solar_private.text_field(body,'fault',2000);
    perform pg_advisory_xact_lock(hashtextextended('service-asset:'||serial_label,0));
    select * into asset from solar_private.service_assets a where a.serial=serial_label and a.customer_id=actor;
    if not found then raise sqlstate 'PT404' using message='equipment_not_found'; end if;
    select * into t from solar_private.service_tickets x where x.serial=serial_label and x.closed_at is null;
    if found then
        if t.fault<>problem then raise sqlstate 'PT409' using message='active_ticket_exists'; end if;
        return solar_private.ticket_detail(t);
    end if;
    if asset.replacement_serial is not null then raise sqlstate 'PT409' using message='equipment_replaced'; end if;
    opened:=clock_timestamp();
    coverage:=solar_private.service_coverage(asset.starts_on,asset.expires_on,solar_private.india_date(opened));
    insert into solar_private.service_tickets(order_id,serial,warranty_id,warranty_starts_on,warranty_expires_on,coverage,fault,opened_by,opened_at)
    values(asset.order_id,serial_label,asset.warranty_id,asset.starts_on,asset.expires_on,coverage,problem,actor,opened)
    returning * into t;
    perform solar_private.service_event(t.id,actor,'opened',jsonb_build_object('coverage',coverage));
    return solar_private.ticket_detail(t);
end $$;
create function solar_private.assign_service(actor uuid,t solar_private.service_tickets,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare tech uuid; saved solar_private.service_tickets;
begin
    perform solar_private.fields(body,array['technician_id']);
    tech:=solar_private.text_field(body,'technician_id',36)::uuid;
    if t.state not in ('open','assigned') then raise sqlstate 'PT409' using message='ticket_locked'; end if;
    if not solar_private.current_technician(tech) then raise sqlstate 'PT409' using message='technician_unavailable'; end if;
    if t.technician_id=tech then return solar_private.ticket_detail(t); end if;
    update solar_private.service_tickets set technician_id=tech,state='assigned' where id=t.id returning * into saved;
    perform solar_private.service_event(t.id,actor,'assigned',jsonb_build_object('technician_id',tech,'previous_technician_id',t.technician_id));
    return solar_private.ticket_detail(saved);
end $$;

create function solar_private.log_technician_time(tech uuid,resolution uuid,installation uuid,day date,worked_minutes integer)
returns solar_private.technician_time language plpgsql set search_path='' as $$
declare rate bigint; entry solar_private.technician_time;
begin
    select r.hourly_paise into rate from solar_private.technician_rates r where r.technician_id=tech;
    if not found then raise sqlstate 'PT409' using message='technician_rate_required'; end if;
    insert into solar_private.technician_time(technician_id,service_resolution_id,installation_report_id,worked_on,minutes,hourly_paise)
    values(tech,resolution,installation,day,worked_minutes,rate) returning * into entry;
    return entry;
end $$;

create function solar_private.resolve_service(actor uuid,t solar_private.service_tickets,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare saved solar_private.service_tickets; r solar_private.service_resolutions; asset solar_private.service_assets;
    line jsonb; parts jsonb; item text; qty integer; charge bigint; sku solar_private.stock_items;
    serials text[]; seen text[]:='{}'; movement uuid; labour bigint; parts_total bigint:=0; worked_minutes integer; day date;
    replacement text; diagnosis text; work text;
begin
    perform solar_private.fields(body,array['diagnosis','work_performed','worked_on','minutes','labour_charge_paise','parts']);
    select * into r from solar_private.service_resolutions x where x.ticket_id=t.id;
    if found then
        if r.submission<>body then raise sqlstate 'PT409' using message='ticket_locked'; end if;
        return solar_private.ticket_detail(t);
    end if;
    if t.state<>'assigned' then raise sqlstate 'PT409' using message='assignment_required'; end if;
    diagnosis:=solar_private.text_field(body,'diagnosis',2000);
    work:=solar_private.text_field(body,'work_performed',4000);
    worked_minutes:=solar_private.amount(body,'minutes',0,10080);
    day:=solar_private.case_date(body,'worked_on',solar_private.india_date(t.opened_at));
    labour:=solar_private.amount(body,'labour_charge_paise',0,1000000000);
    if worked_minutes=0 and labour<>0 then raise sqlstate 'PT400' using message='labour_time_required'; end if;
    if t.coverage='covered' and labour<>0 then raise sqlstate 'PT409' using message='covered_charge_forbidden'; end if;
    parts:=body->'parts';
    if (case when jsonb_typeof(parts)='array' then jsonb_array_length(parts)>25 else true end) then
        raise sqlstate 'PT400' using message='invalid_service_parts';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('service-asset:'||t.serial,0));
    select * into strict asset from solar_private.service_assets a where a.serial=t.serial and a.order_id=t.order_id;
    if asset.replacement_serial is not null then raise sqlstate 'PT409' using message='equipment_replaced'; end if;
    -- Lock the same catalogue rows, in the same order as reservations and dispatch.
    perform s.item_id from solar_private.stock_items s where s.item_id in (select x->>'item_id' from jsonb_array_elements(parts) x)
        order by s.item_id for update;
    for line in select value from jsonb_array_elements(parts) order by value->>'item_id' loop
        perform solar_private.fields(line,array['item_id','quantity','unit_charge_paise','serials']);
        item:=solar_private.text_field(line,'item_id',120);
        qty:=solar_private.amount(line,'quantity',1,1000);
        charge:=solar_private.amount(line,'unit_charge_paise',0,1000000000);
        if item<>line->>'item_id' or item=any(seen) then raise sqlstate 'PT400' using message='invalid_service_parts'; end if;
        seen:=array_append(seen,item);
        select * into sku from solar_private.stock_items s where s.item_id=item;
        if not found then raise sqlstate 'PT404' using message='item_not_found'; end if;
        if t.coverage='covered' and charge<>0 then raise sqlstate 'PT409' using message='covered_charge_forbidden'; end if;
        if sku.serialized and (sku.item_id<>asset.item_id or qty<>1) then
            raise sqlstate 'PT409' using message='replacement_sku_mismatch';
        end if;
        serials:=solar_private.serial_list(line->'serials',case when sku.serialized then 1 else 0 end);
        if not exists(select 1 from solar_private.stock_availability s where s.item_id=item and s.available>=qty) then
            raise sqlstate 'PT409' using message='stock_shortage';
        end if;
        insert into solar_private.stock_movements(item_id,kind,delta,service_ticket_id,actor_id)
            values(item,'service_issue',-qty,t.id,actor) returning id into movement;
        if not exists(select 1 from solar_private.movement_costs c where c.movement_id=movement) then
            raise sqlstate 'PT409' using message='material_rate_required';
        end if;
        update solar_private.stock_items set on_hand=on_hand-qty where item_id=item;
        insert into solar_private.service_parts values(movement,charge);
        if sku.serialized then
            replacement:=serials[1];
            insert into solar_private.shipment_serials(serial,item_id,movement_id)
                select s.serial,s.item_id,movement from solar_private.stock_serials s where s.serial=replacement and s.item_id=item
                on conflict do nothing;
            if not found then raise sqlstate 'PT409' using message='serial_unavailable'; end if;
            insert into solar_private.service_replacements(ticket_id,order_id,old_serial,new_serial,item_id,warranty_id,installed_by)
            values(t.id,t.order_id,t.serial,replacement,item,asset.warranty_id,actor);
        end if;
        parts_total:=parts_total+qty*charge;
    end loop;
    insert into solar_private.service_resolutions(ticket_id,technician_id,diagnosis,work_performed,labour_charge_paise,submission)
    values(t.id,actor,diagnosis,work,labour,body) returning * into r;
    if worked_minutes>0 then perform solar_private.log_technician_time(actor,r.id,null,day,worked_minutes); end if;
    if t.coverage<>'covered' then
        insert into solar_private.service_invoices(ticket_id,resolution_id,posted_by,parts_paise,labour_paise)
            values(t.id,r.id,actor,parts_total,labour);
    end if;
    update solar_private.service_tickets set state='awaiting_confirmation' where id=t.id returning * into saved;
    perform solar_private.service_event(t.id,actor,'resolved',jsonb_build_object('resolution_id',r.id));
    return solar_private.ticket_detail(saved);
end $$;
create function solar_private.confirm_service(actor uuid,t solar_private.service_tickets,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare resolution uuid; saved solar_private.service_tickets;
begin
    perform solar_private.fields(body,array['resolution_id','accepted']);
    if body->'accepted'<>'true'::jsonb then raise sqlstate 'PT400' using message='acceptance_required'; end if;
    resolution:=solar_private.text_field(body,'resolution_id',36)::uuid;
    if t.state not in ('awaiting_confirmation','closed') or not exists(
        select 1 from solar_private.service_resolutions r where r.id=resolution and r.ticket_id=t.id) then
        raise sqlstate 'PT409' using message='resolution_required';
    end if;
    if t.state='closed' then return solar_private.ticket_detail(t); end if;
    update solar_private.service_tickets set state='closed',closed_by=actor,closed_at=clock_timestamp()
        where id=t.id returning * into saved;
    perform solar_private.service_event(t.id,actor,'confirmed',jsonb_build_object('resolution_id',resolution));
    return solar_private.ticket_detail(saved);
end $$;

create function solar_private.record_service_collection(actor uuid,t solar_private.service_tickets,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare invoice solar_private.service_invoices; prior solar_private.service_collections;
    amount bigint; method_name text; payment_ref text; day date; collected bigint;
begin
    perform solar_private.fields(body,array['amount_paise','method','reference','collected_on']);
    select * into invoice from solar_private.service_invoices i where i.ticket_id=t.id;
    if not found then raise sqlstate 'PT409' using message='invoice_required'; end if;
    amount:=solar_private.amount(body,'amount_paise',1,26000000000000);
    method_name:=solar_private.text_field(body,'method',12);
    if method_name not in ('bank','cash') then raise sqlstate 'PT400' using message='invalid_payment_method'; end if;
    payment_ref:=solar_private.text_field(body,'reference',100);
    day:=solar_private.case_date(body,'collected_on',solar_private.india_date(invoice.posted_at));
    -- The enclosing command has locked the ticket, serializing allocations to its invoice.
    select * into prior from solar_private.service_collections c where c.method=method_name and c.reference=payment_ref;
    if found then
        if (prior.invoice_id,prior.amount_paise,prior.collected_on) is distinct from (invoice.id,amount,day) then
            raise sqlstate 'PT409' using message='payment_reference_conflict';
        end if;
        return solar_private.ticket_detail(t);
    end if;
    select coalesce(sum(c.amount_paise),0) into collected from solar_private.service_collections c where c.invoice_id=invoice.id;
    if amount>invoice.parts_paise+invoice.labour_paise-collected then
        raise sqlstate 'PT409' using message='payment_exceeds_balance';
    end if;
    insert into solar_private.service_collections(invoice_id,amount_paise,method,reference,collected_on,recorded_by)
        values(invoice.id,amount,method_name,payment_ref,day,actor) on conflict do nothing returning * into prior;
    if not found then raise sqlstate 'PT409' using message='payment_reference_conflict'; end if;
    perform solar_private.service_event(t.id,actor,'payment_recorded',jsonb_build_object('collection_id',prior.id,'amount_paise',amount));
    return solar_private.ticket_detail(t);
end $$;

create function solar_private.service_read(resource text,target uuid,after_id uuid,serial_filter text,after_serial text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a record; t solar_private.service_tickets;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if (serial_filter is not null and not solar_private.valid_serial(serial_filter)) or
        (after_serial is not null and not solar_private.valid_serial(after_serial)) then
        raise sqlstate 'PT400' using message='invalid_serial';
    end if;
    if resource='equipment' then
        if a.role not in ('customer','admin','technician','inventory') then raise sqlstate 'PT403' using message='forbidden'; end if;
        return (select jsonb_build_object('items',coalesce(jsonb_agg(rows.asset order by rows.serial),'[]'))
            from (select x.serial,jsonb_build_object('serial',x.serial,'item_id',x.item_id,'order_id',x.order_id,
                'order_reference','ORD-'||x.order_id,'work_order_id',x.work_id,'available_since',x.available_since,
                'warranty_id',x.warranty_id,'starts_on',x.starts_on,'expires_on',x.expires_on,
                'coverage',solar_private.service_coverage(x.starts_on,x.expires_on,solar_private.india_date(now())),
                'previous_serial',x.previous_serial,'replacement_serial',x.replacement_serial,
                'state',case when x.replacement_serial is null then 'in_service' else 'replaced' end) as asset
            from solar_private.service_assets x where (serial_filter is null or x.serial=serial_filter)
                and (after_serial is null or x.serial>after_serial)
                and (a.role in ('admin','inventory') or (a.role='customer' and x.customer_id=a.id)
                or (a.role='technician' and (x.technician_id=a.id or exists(select 1 from solar_private.service_tickets v
                    where v.technician_id=a.id and v.serial in (x.serial,x.previous_serial) and v.order_id=x.order_id))))
            order by x.serial limit 50) rows);
    end if;
    if a.role not in ('customer','admin','technician') then raise sqlstate 'PT403' using message='forbidden'; end if;
    if resource='tickets' then
        return (select jsonb_build_object('items',coalesce(jsonb_agg(rows.ticket order by rows.id),'[]'))
            from (select v.id,solar_private.ticket_summary(v) as ticket from solar_private.service_tickets v
            where (after_id is null or v.id>after_id) and (serial_filter is null or v.serial=serial_filter)
                and solar_private.ticket_visible(v,a.id,a.role) order by v.id limit 50) rows);
    end if;
    select * into t from solar_private.service_tickets v where resource='ticket' and v.id=target
        and solar_private.ticket_visible(v,a.id,a.role);
    if not found then raise sqlstate 'PT404' using message='ticket_not_found'; end if;
    return solar_private.ticket_detail(t);
end $$;

create function solar_private.service_command(cmd text,target uuid,k uuid,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; t solar_private.service_tickets; result jsonb; required text; command_name text:='service_'||cmd;
begin
    required:=case cmd when 'open' then 'customer' when 'confirm' then 'customer' when 'assign' then 'admin'
        when 'resolve' then 'technician' when 'collect' then 'admin' end;
    if required is null then raise sqlstate 'PT404' using message='not_found'; end if;
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if a.role<>required then raise sqlstate 'PT403' using message='forbidden'; end if;
    if cmd='open' then
        if target is not null then raise sqlstate 'PT400' using message='invalid_target'; end if;
    else
        select * into t from solar_private.service_tickets v where v.id=target
        and solar_private.ticket_visible(v,a.id,a.role) for update;
        if not found then raise sqlstate 'PT404' using message='ticket_not_found'; end if;
    end if;
    result:=solar_private.replay(a.id,k,command_name,target,body);
    if result is not null then return result; end if;
    case cmd
        when 'open' then result:=solar_private.open_service(a.id,body);
        when 'assign' then result:=solar_private.assign_service(a.id,t,body);
        when 'resolve' then result:=solar_private.resolve_service(a.id,t,body);
        when 'confirm' then result:=solar_private.confirm_service(a.id,t,body);
        when 'collect' then result:=solar_private.record_service_collection(a.id,t,body);
    end case;
    return solar_private.remember(a.id,k,command_name,target,body,result);
end $$;

revoke all on function solar_private.india_date(timestamptz),solar_private.service_coverage(date,date,date),
    solar_private.case_date(jsonb,text,date),solar_private.capture_movement_cost(),solar_private.current_technician(uuid),
    solar_private.ticket_visible(solar_private.service_tickets,uuid,text),solar_private.ticket_summary(solar_private.service_tickets),
    solar_private.ticket_detail(solar_private.service_tickets),solar_private.service_event(uuid,uuid,text,jsonb),
    solar_private.open_service(uuid,jsonb),solar_private.assign_service(uuid,solar_private.service_tickets,jsonb),
    solar_private.log_technician_time(uuid,uuid,uuid,date,integer),
    solar_private.resolve_service(uuid,solar_private.service_tickets,jsonb),solar_private.confirm_service(uuid,solar_private.service_tickets,jsonb),
    solar_private.record_service_collection(uuid,solar_private.service_tickets,jsonb)
from public,anon,authenticated,service_role;

create function public.solar_service_read(resource text,target uuid,after_id uuid,serial_filter text,after_serial text)
returns jsonb language sql stable security invoker set search_path='' as $$
    select solar_private.service_read($1,$2,$3,$4,$5)
$$;
create function public.solar_service_command(cmd text,target uuid,k uuid,body jsonb)
returns jsonb language sql security invoker set search_path='' as $$
    select solar_private.service_command($1,$2,$3,$4)
$$;
revoke all on function solar_private.service_read(text,uuid,uuid,text,text),public.solar_service_read(text,uuid,uuid,text,text),
    solar_private.service_command(text,uuid,uuid,jsonb),public.solar_service_command(text,uuid,uuid,jsonb)
from public,anon,authenticated,service_role;
grant execute on function solar_private.service_read(text,uuid,uuid,text,text),public.solar_service_read(text,uuid,uuid,text,text),
    solar_private.service_command(text,uuid,uuid,jsonb),public.solar_service_command(text,uuid,uuid,jsonb) to authenticated;
