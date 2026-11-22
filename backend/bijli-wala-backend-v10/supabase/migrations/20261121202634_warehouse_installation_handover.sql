alter table solar_private.stock_items
    add column serialized boolean not null default false,
    add column warranty_months integer check (warranty_months between 1 and 600),
    add check (serialized or warranty_months is null);
alter table solar_private.order_reservations add column consumed_at timestamptz;
alter table solar_private.pick_lists drop constraint pick_lists_state_check;
alter table solar_private.pick_lists add check (state in ('ready_to_pick','dispatched'));
alter table solar_private.installation_work_orders drop constraint installation_work_orders_state_check;
alter table solar_private.installation_work_orders
    add check (state in ('ready_to_schedule','scheduled','test_failed','awaiting_signoff','completed')),
    add column technician_id uuid references public.solar_profiles,
    add column scheduled_at timestamptz,
    add column scheduled_by uuid references public.solar_profiles,
    add check ((state='ready_to_schedule')=(technician_id is null) and
        (technician_id is null)=(scheduled_at is null) and (technician_id is null)=(scheduled_by is null));
create index installation_by_technician on solar_private.installation_work_orders(technician_id,id);

create table solar_private.shipments (
    id uuid primary key default gen_random_uuid(),
    pick_list_id uuid not null unique references solar_private.pick_lists,
    dispatched_by uuid not null references public.solar_profiles,
    dispatched_at timestamptz not null default clock_timestamp(),
    delivered_by uuid references public.solar_profiles,
    delivered_at timestamptz,
    check ((delivered_at is null) = (delivered_by is null) and delivered_at >= dispatched_at)
);
create table solar_private.stock_movements (
    id uuid primary key default gen_random_uuid(),
    item_id text not null references solar_private.stock_items,
    kind text not null check (kind in ('opening','receipt','dispatch')),
    delta integer not null,
    shipment_id uuid references solar_private.shipments,
    actor_id uuid references public.solar_profiles,
    occurred_at timestamptz not null default clock_timestamp(),
    check ((kind='dispatch' and delta<0 and shipment_id is not null) or
        (kind in ('opening','receipt') and delta>0 and shipment_id is null)),
    check ((kind='opening') = (actor_id is null)),
    unique (shipment_id,item_id),
    unique (id,item_id)
);
create unique index one_opening_balance on solar_private.stock_movements(item_id) where kind='opening';
create index stock_movements_by_item on solar_private.stock_movements(item_id,occurred_at,id);
create table solar_private.stock_serials (
    serial text primary key check (serial ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$'),
    item_id text not null references solar_private.stock_items,
    receipt_id uuid not null,
    foreign key (receipt_id,item_id) references solar_private.stock_movements(id,item_id),
    unique (serial,item_id)
);
create index stock_serials_by_item on solar_private.stock_serials(item_id,serial);
create index stock_serials_by_receipt on solar_private.stock_serials(receipt_id);
create table solar_private.shipment_serials (
    serial text primary key,
    item_id text not null,
    movement_id uuid not null,
    foreign key (serial,item_id) references solar_private.stock_serials(serial,item_id),
    foreign key (movement_id,item_id) references solar_private.stock_movements(id,item_id)
);
create index shipment_serials_by_movement on solar_private.shipment_serials(movement_id);
create table solar_private.warranties (
    id uuid primary key default gen_random_uuid(),
    serial text not null unique references solar_private.shipment_serials,
    term_months integer not null check (term_months between 1 and 600),
    starts_on date not null,
    expires_on date not null check (expires_on>starts_on)
);
create table solar_private.installation_reports (
    id uuid primary key default gen_random_uuid(),
    work_id uuid not null references solar_private.installation_work_orders,
    technician_id uuid not null references public.solar_profiles,
    started_at timestamptz not null,
    ended_at timestamptz not null check (ended_at>started_at),
    system_kw numeric(7,3) not null check (system_kw>0),
    generation_test text not null check (generation_test in ('pass','fail')),
    recorded_at timestamptz not null default clock_timestamp(),
    unique(id,work_id)
);
create index installation_reports_by_work on solar_private.installation_reports(work_id,recorded_at desc,id);
create table solar_private.installation_report_photos (
    report_id uuid not null references solar_private.installation_reports,
    path text not null,
    primary key (report_id,path)
);
create index report_photos_by_path on solar_private.installation_report_photos(path);
create table solar_private.installation_signoffs (
    work_id uuid primary key references solar_private.installation_work_orders,
    report_id uuid not null,
    foreign key (report_id,work_id) references solar_private.installation_reports(id,work_id),
    customer_id uuid not null references public.solar_profiles,
    signed_at timestamptz not null default clock_timestamp()
);
create table solar_private.installation_schedule_events (
    id uuid primary key default gen_random_uuid(),
    work_id uuid not null references solar_private.installation_work_orders,
    technician_id uuid not null references public.solar_profiles,
    scheduled_by uuid not null references public.solar_profiles,
    scheduled_at timestamptz not null,
    recorded_at timestamptz not null default clock_timestamp()
);
create index installation_schedule_by_work on solar_private.installation_schedule_events(work_id);

do $$ declare rel text;
begin
    foreach rel in array array['shipments','stock_movements','stock_serials','shipment_serials','warranties',
                               'installation_reports','installation_report_photos','installation_signoffs',
                               'installation_schedule_events'] loop
        execute format('alter table solar_private.%I enable row level security',rel);
        execute format('revoke all on solar_private.%I from public, anon, authenticated, service_role',rel);
    end loop;
end $$;

-- Opening balances preserve existing checkout availability. The inverter's
-- opening serials and both warranty durations apply to the demo catalogue.
update solar_private.stock_items set serialized=true,
    warranty_months=case item_id when 'DEMO-INVERTER' then 60 else 24 end
where item_id in ('DEMO-INVERTER','DEMO-BATTERY');
insert into solar_private.stock_movements(item_id,kind,delta)
select item_id,'opening',on_hand from solar_private.stock_items where on_hand>0;
insert into solar_private.stock_serials(serial,item_id,receipt_id)
select 'OPENING-'||s.item_id||'-'||n,s.item_id,m.id
from solar_private.stock_items s join solar_private.stock_movements m using(item_id)
cross join lateral generate_series(1,s.on_hand) n where s.serialized and m.kind='opening';

create or replace view solar_private.stock_availability with(security_invoker=true) as
    select s.item_id,s.name,s.suggested_unit_paise,s.on_hand,
           h.qty as held,r.qty as reserved,(s.on_hand-h.qty-r.qty)::integer as available
    from solar_private.stock_items s
    cross join lateral (select coalesce(sum(l.quantity),0)::integer as qty from solar_private.stock_holds l
        join solar_private.checkout_attempts c on c.id=l.attempt_id where l.item_id=s.item_id
        and c.state in ('creating','ready','uncertain') and c.expires_at>clock_timestamp()) h
    cross join lateral (select coalesce(sum(l.quantity),0)::integer as qty from solar_private.order_reservations l
        where l.item_id=s.item_id and l.consumed_at is null) r;
create or replace function solar_private.demo_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text;
begin
    select role into role_name from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if role_name not in ('admin','technician','inventory') then raise sqlstate 'PT403' using message='forbidden'; end if;
    return (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('serialized',s.serialized,
        'warranty_months',s.warranty_months) order by a.item_id),'[]')
        from solar_private.stock_availability a join solar_private.stock_items s using(item_id));
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('installation-evidence','installation-evidence',false,8388608,array['image/jpeg','image/png','image/webp']);

create function solar_private.project_visible(actor uuid,role_name text,customer uuid,technician uuid,salesperson uuid)
returns boolean language sql immutable set search_path='' as $$
    select coalesce(case role_name when 'admin' then true when 'inventory' then true
        when 'customer' then actor=customer when 'technician' then actor=technician
        when 'sales' then actor=salesperson else false end,false)
$$;

create function solar_private.evidence_work(path text) returns uuid
language sql immutable set search_path='' as $$
    select case when path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp)$'
        then split_part(path,'/',1)::uuid end
$$;
create function solar_private.evidence_access(path text, uploading boolean) returns boolean
language sql stable security definer set search_path='' as $$
    select exists (
        select 1 from solar_private.actor() a
        join solar_private.installation_work_orders w on w.id=solar_private.evidence_work(path)
        join solar_private.sales_orders o on o.id=w.order_id
        join solar_private.quotes q on q.id=o.quote_id
        join solar_private.enquiries e on e.id=q.enquiry_id
        where case when uploading then a.role='technician' and w.technician_id=a.id and w.state in ('scheduled','test_failed')
            else a.role='admin' or (a.role='technician' and w.technician_id=a.id) or
                (a.role='customer' and e.customer_id=a.id and exists(
                    select 1 from solar_private.installation_report_photos p where p.path=evidence_access.path))
            end
    )
$$;
revoke all on function solar_private.evidence_access(text,boolean) from public,anon,authenticated,service_role;
grant execute on function solar_private.evidence_access(text,boolean) to authenticated;
create policy installation_evidence_upload on storage.objects for insert to authenticated
with check (bucket_id='installation-evidence' and solar_private.evidence_access(name,true));
create policy installation_evidence_read on storage.objects for select to authenticated
using (bucket_id='installation-evidence' and solar_private.evidence_access(name,false));

create view solar_private.fulfilment_projects with(security_invoker=true) as
select o.id,o.quote_id,o.confirmed_at,e.id as enquiry_id,e.serial_no,e.customer_id,e.salesperson_id,
       s.address,p.id as pick_list_id,p.state as pick_state,w.id as work_id,w.state as work_state,
       w.technician_id,w.scheduled_at,w.scheduled_by,h.id as shipment_id,h.dispatched_at,h.delivered_at
from solar_private.sales_orders o join solar_private.quotes q on q.id=o.quote_id
join solar_private.enquiries e on e.id=q.enquiry_id join solar_private.sites s on s.id=e.site_id
join solar_private.pick_lists p on p.order_id=o.id
join solar_private.installation_work_orders w on w.order_id=o.id
left join solar_private.shipments h on h.pick_list_id=p.id;
revoke all on solar_private.fulfilment_projects from public,anon,authenticated,service_role;

create function solar_private.require_role(allowed text[]) returns uuid
language plpgsql stable set search_path='' as $$
declare a record;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if not a.role=any(allowed) then raise sqlstate 'PT403' using message='forbidden'; end if;
    return a.id;
end $$;
create function solar_private.valid_serial(value text) returns boolean
language sql immutable set search_path='' as $$
    select coalesce(value ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$',false)
$$;
create function solar_private.serial_list(value jsonb, expected integer) returns text[]
language plpgsql immutable set search_path='' as $$
declare result text[];
begin
    if (case when jsonb_typeof(value)='array' then jsonb_array_length(value)<>expected else true end) then
        raise sqlstate 'PT400' using message='invalid_serial_count';
    end if;
    if exists (select 1 from jsonb_array_elements(value) x where jsonb_typeof(x)<>'string'
        or not solar_private.valid_serial(x#>>'{}')) then
        raise sqlstate 'PT400' using message='invalid_serial';
    end if;
    select coalesce(array_agg(x order by x),'{}') into result from jsonb_array_elements_text(value) x;
    if cardinality(result)<>(select count(distinct x) from unnest(result) x) then
        raise sqlstate 'PT409' using message='duplicate_serial';
    end if;
    return result;
end $$;

create function solar_private.receive_stock(actor uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare item text; qty integer; serials text[]; s solar_private.stock_items; m solar_private.stock_movements; seen integer;
begin
    perform solar_private.fields(body,array['item_id','quantity','serials']);
    item:=solar_private.text_field(body,'item_id',120);
    qty:=solar_private.amount(body,'quantity',1,1000);
    select * into s from solar_private.stock_items where item_id=item for update;
    if not found then raise sqlstate 'PT404' using message='item_not_found'; end if;
    serials:=solar_private.serial_list(body->'serials',case when s.serialized then qty else 0 end);
    if s.on_hand::bigint+qty>2147483647 then raise sqlstate 'PT409' using message='stock_limit'; end if;
    insert into solar_private.stock_movements(item_id,kind,delta,actor_id) values (item,'receipt',qty,actor) returning * into m;
    insert into solar_private.stock_serials(serial,item_id,receipt_id)
        select serial,item,m.id from unnest(serials) serial order by serial on conflict do nothing;
    get diagnostics seen = row_count;
    if seen<>cardinality(serials) then
        raise sqlstate 'PT409' using message='serial_already_registered';
    end if;
    update solar_private.stock_items set on_hand=on_hand+qty where item_id=item;
    return to_jsonb(m)||jsonb_build_object('serials',serials);
end $$;

create function solar_private.shipment_view(h solar_private.shipments) returns jsonb
language sql stable set search_path='' as $$
    select to_jsonb(h)||jsonb_build_object('state',case when h.delivered_at is null then 'dispatched' else 'delivered' end,
        'lines',(select jsonb_agg(jsonb_build_object('item_id',m.item_id,'quantity',-m.delta,
            'serials',(select coalesce(jsonb_agg(x.serial order by x.serial),'[]') from solar_private.shipment_serials x
            where x.movement_id=m.id)) order by m.item_id) from solar_private.stock_movements m where m.shipment_id=h.id))
$$;
create function solar_private.dispatch_stock(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p solar_private.pick_lists; h solar_private.shipments; line jsonb; manifest jsonb:='[]';
    item text; qty integer; s solar_private.stock_items; serials text[]; m uuid; seen integer;
begin
    perform solar_private.fields(body,array['lines']);
    if (case when jsonb_typeof(body->'lines')='array' then jsonb_array_length(body->'lines') not between 1 and 32 else true end) then
        raise sqlstate 'PT400' using message='invalid_shipment_lines';
    end if;
    select * into p from solar_private.pick_lists where id=target for update;
    if not found then raise sqlstate 'PT404' using message='pick_list_not_found'; end if;
    -- Same row-lock order as checkout and capture. Reservations stay in history.
    perform s0.item_id from solar_private.stock_items s0
        join solar_private.order_reservations r using(item_id) where r.order_id=p.order_id
        order by s0.item_id for update of s0;
    for line in select value from jsonb_array_elements(body->'lines') order by value->>'item_id' loop
        perform solar_private.fields(line,array['item_id','quantity','serials']);
        item:=solar_private.text_field(line,'item_id',120);
        qty:=solar_private.amount(line,'quantity',1,1000000);
        select s0.* into s from solar_private.stock_items s0 join solar_private.order_reservations r using(item_id)
        where r.order_id=p.order_id and r.item_id=item and r.quantity=qty;
        if not found or exists(select 1 from jsonb_array_elements(manifest) x where x->>'item_id'=item) then
            raise sqlstate 'PT409' using message='reservation_mismatch';
        end if;
        serials:=solar_private.serial_list(line->'serials',case when s.serialized then qty else 0 end);
        manifest:=manifest||jsonb_build_array(jsonb_build_object('item_id',item,'quantity',qty,'serials',serials));
    end loop;
    if (select count(*) from solar_private.order_reservations where order_id=p.order_id)<>jsonb_array_length(manifest) then
        raise sqlstate 'PT409' using message='reservation_mismatch';
    end if;
    select * into h from solar_private.shipments where pick_list_id=target;
    if found then
        if solar_private.shipment_view(h)->'lines'<>manifest then raise sqlstate 'PT409' using message='already_dispatched'; end if;
        return solar_private.shipment_view(h);
    end if;
    insert into solar_private.shipments(pick_list_id,dispatched_by) values(target,actor) returning * into h;
    for line in select value from jsonb_array_elements(manifest) loop
        item:=line->>'item_id';
        qty:=(line->>'quantity')::integer;
        update solar_private.order_reservations set consumed_at=h.dispatched_at
        where order_id=p.order_id and item_id=item and consumed_at is null;
        if not found then raise sqlstate 'PT409' using message='reservation_mismatch'; end if;
        update solar_private.stock_items set on_hand=on_hand-qty where item_id=item and on_hand>=qty;
        if not found then raise sqlstate 'PT409' using message='stock_shortage'; end if;
        insert into solar_private.stock_movements(item_id,kind,delta,shipment_id,actor_id)
            values (item,'dispatch',-qty,h.id,actor) returning id into m;
        insert into solar_private.shipment_serials(serial,item_id,movement_id)
            select s0.serial,item,m from jsonb_array_elements_text(line->'serials') x
            join solar_private.stock_serials s0 on s0.serial=x.value and s0.item_id=item
            order by s0.serial on conflict do nothing;
        get diagnostics seen = row_count;
        if seen<>jsonb_array_length(line->'serials') then raise sqlstate 'PT409' using message='serial_unavailable'; end if;
    end loop;
    update solar_private.pick_lists set state='dispatched' where id=target;
    return solar_private.shipment_view(h);
end $$;

create function solar_private.deliver_shipment(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h solar_private.shipments; starts date;
begin
    perform solar_private.fields(body,array[]::text[]);
    select * into h from solar_private.shipments where id=target for update;
    if not found then raise sqlstate 'PT404' using message='shipment_not_found'; end if;
    if h.delivered_at is null then
        update solar_private.shipments set delivered_at=clock_timestamp(),delivered_by=actor where id=target returning * into h;
        starts:=(h.delivered_at at time zone 'Asia/Kolkata')::date;
        insert into solar_private.warranties(serial,term_months,starts_on,expires_on)
        select x.serial,s.warranty_months,starts,(starts+make_interval(months=>s.warranty_months))::date
        from solar_private.stock_movements m join solar_private.shipment_serials x on x.movement_id=m.id
        join solar_private.stock_items s on s.item_id=m.item_id
        where m.shipment_id=target and s.warranty_months is not null;
    end if;
    return solar_private.shipment_view(h);
end $$;

create function solar_private.schedule_installation(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare w solar_private.installation_work_orders; technician uuid; appointment timestamptz;
begin
    perform solar_private.fields(body,array['technician_id','scheduled_at']);
    technician:=solar_private.text_field(body,'technician_id',36)::uuid;
    appointment:=solar_private.text_field(body,'scheduled_at',40)::timestamptz;
    select * into w from solar_private.installation_work_orders where id=target for update;
    if not found then raise sqlstate 'PT404' using message='work_order_not_found'; end if;
    if w.state not in ('ready_to_schedule','scheduled','test_failed') then
        raise sqlstate 'PT409' using message='installation_locked';
    end if;
    if not isfinite(appointment) or appointment<=clock_timestamp() then
        raise sqlstate 'PT400' using message='invalid_schedule';
    end if;
    if not exists(select 1 from solar_private.staff_assignments s join auth.users u on u.id=s.user_id
        where s.user_id=technician and s.role='technician' and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())) then
        raise sqlstate 'PT409' using message='technician_unavailable';
    end if;
    update solar_private.installation_work_orders set state='scheduled',technician_id=technician,
        scheduled_at=appointment,scheduled_by=actor where id=target returning * into w;
    insert into solar_private.installation_schedule_events(work_id,technician_id,scheduled_by,scheduled_at)
    values(target,technician,actor,appointment);
    return to_jsonb(w);
end $$;

create function solar_private.report_view(r solar_private.installation_reports) returns jsonb
language sql stable set search_path='' as $$
    select to_jsonb(r)||jsonb_build_object('photo_paths',(select coalesce(jsonb_agg(p.path order by p.path),'[]')
        from solar_private.installation_report_photos p where p.report_id=r.id))
$$;
create function solar_private.record_installation(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare w solar_private.installation_work_orders; r solar_private.installation_reports;
    starts timestamptz; ends timestamptz; outcome text; kw numeric; paths text[];
begin
    perform solar_private.fields(body,array['started_at','ended_at','system_kw','generation_test','photo_paths']);
    select * into w from solar_private.installation_work_orders where id=target and technician_id=actor for update;
    if not found then raise sqlstate 'PT404' using message='work_order_not_found'; end if;
    if w.state not in ('scheduled','test_failed') then raise sqlstate 'PT409' using message='installation_locked'; end if;
    if not exists(select 1 from solar_private.fulfilment_projects p where p.work_id=w.id and p.delivered_at is not null) then
        raise sqlstate 'PT409' using message='delivery_required';
    end if;
    starts:=solar_private.text_field(body,'started_at',40)::timestamptz;
    ends:=solar_private.text_field(body,'ended_at',40)::timestamptz;
    if starts<(select confirmed_at from solar_private.sales_orders where id=w.order_id)
        or starts>=ends or ends>clock_timestamp() then
        raise sqlstate 'PT400' using message='invalid_installation_times';
    end if;
    kw:=solar_private.amount(body,'system_kw',0.001,9999.999,3);
    outcome:=solar_private.text_field(body,'generation_test',4);
    if outcome not in ('pass','fail') then raise sqlstate 'PT400' using message='invalid_generation_test'; end if;
    if (case when jsonb_typeof(body->'photo_paths')='array' then jsonb_array_length(body->'photo_paths') not between 1 and 10 else true end) then
        raise sqlstate 'PT400' using message='evidence_required';
    end if;
    select array_agg(x) into paths from jsonb_array_elements_text(body->'photo_paths') x;
    if cardinality(paths)<>(select count(distinct x) from unnest(paths) x) or exists (
        select 1 from unnest(paths) x where solar_private.evidence_work(x) is distinct from target
        or not exists(select 1 from storage.objects obj where obj.bucket_id='installation-evidence' and obj.name=x
            and obj.metadata->>'mimetype'=case split_part(x,'.',2) when 'jpg' then 'image/jpeg'
                when 'png' then 'image/png' when 'webp' then 'image/webp' end)
    ) then
        raise sqlstate 'PT409' using message='invalid_evidence';
    end if;
    insert into solar_private.installation_reports(work_id,technician_id,started_at,ended_at,system_kw,generation_test)
        values(target,actor,starts,ends,kw,outcome) returning * into r;
    insert into solar_private.installation_report_photos(report_id,path) select r.id,x from unnest(paths) x;
    update solar_private.installation_work_orders set state=case when outcome='pass' then 'awaiting_signoff' else 'test_failed' end
    where id=target returning * into w;
    return jsonb_build_object('work_order',to_jsonb(w),'report',solar_private.report_view(r));
end $$;

create function solar_private.signoff_installation(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare w solar_private.installation_work_orders; signoff solar_private.installation_signoffs; r uuid;
begin
    perform solar_private.fields(body,array['report_id','accepted']);
    if body->'accepted'<>'true'::jsonb then raise sqlstate 'PT400' using message='acceptance_required'; end if;
    r:=solar_private.text_field(body,'report_id',36)::uuid;
    select w0.* into w from solar_private.installation_work_orders w0 join solar_private.fulfilment_projects p on p.work_id=w0.id
        where w0.id=target and p.customer_id=actor for update of w0;
    if not found then raise sqlstate 'PT404' using message='work_order_not_found'; end if;
    select * into signoff from solar_private.installation_signoffs where work_id=target;
    if found then
        if signoff.report_id<>r then raise sqlstate 'PT409' using message='installation_locked'; end if;
        return to_jsonb(signoff)||jsonb_build_object('state',w.state);
    end if;
    if w.state<>'awaiting_signoff'
        or not exists(select 1 from solar_private.fulfilment_projects p where p.work_id=target and p.delivered_at is not null)
        or not exists(select 1 from solar_private.installation_reports x where x.work_id=target and x.id=r and x.generation_test='pass')
        or not exists(select 1 from solar_private.installation_report_photos p where p.report_id=r)
        or exists(select 1 from solar_private.installation_report_photos p where p.report_id=r and not exists(
            select 1 from storage.objects obj where obj.bucket_id='installation-evidence' and obj.name=p.path)) then
        raise sqlstate 'PT409' using message='signoff_prerequisites';
    end if;
    insert into solar_private.installation_signoffs(work_id,report_id,customer_id)
        values(target,r,actor) returning * into signoff;
    update solar_private.installation_work_orders set state='completed' where id=target;
    return to_jsonb(signoff)||jsonb_build_object('state','completed');
end $$;

create function solar_private.project_summary(p solar_private.fulfilment_projects) returns jsonb
language sql stable set search_path='' as $$
    select jsonb_build_object('id',p.id,'reference','ORD-'||p.id,'quote_id',p.quote_id,
        'enquiry_id',p.enquiry_id,'enquiry_reference','ENQ-'||p.serial_no,'site',p.address,
        'confirmed_at',p.confirmed_at,'pick_list_id',p.pick_list_id,'pick_state',p.pick_state,
        'shipment_id',p.shipment_id,'dispatched_at',p.dispatched_at,'delivered_at',p.delivered_at,
        'work_order_id',p.work_id,'work_state',p.work_state,'technician_id',p.technician_id,
        'scheduled_at',p.scheduled_at)
$$;
create function solar_private.project_detail(p solar_private.fulfilment_projects,role_name text) returns jsonb
language sql stable set search_path='' as $$
    select solar_private.project_summary(p)||jsonb_build_object(
        'pick_lines',(select coalesce(jsonb_agg(jsonb_build_object('item_id',r.item_id,'quantity',r.quantity,
           'serialized',s.serialized,'consumed_at',r.consumed_at) order by r.item_id),'[]')
           from solar_private.order_reservations r join solar_private.stock_items s using(item_id) where r.order_id=p.id),
        'shipment',(select solar_private.shipment_view(h) from solar_private.shipments h where h.id=p.shipment_id),
        'installation',case when role_name in ('admin','technician','customer') then jsonb_build_object(
            'scheduled_by',p.scheduled_by,
            'report',(select solar_private.report_view(r) from solar_private.installation_reports r where r.work_id=p.work_id
                order by r.recorded_at desc,r.id desc limit 1),
            'signoff',(select to_jsonb(s) from solar_private.installation_signoffs s where s.work_id=p.work_id)) end)
$$;

create function solar_private.fulfilment_read(resource text,target uuid,after_id uuid,item text,serial_filter text,after_serial text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a record; project solar_private.fulfilment_projects; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if resource='serials' then
        if a.role not in ('inventory','admin') then raise sqlstate 'PT403' using message='forbidden'; end if;
        if item is null or char_length(item) not between 1 and 120
            or (after_serial is not null and not solar_private.valid_serial(after_serial)) then
            raise sqlstate 'PT400' using message='invalid_filter';
        end if;
        if not exists(select 1 from solar_private.stock_items s where s.item_id=item) then
            raise sqlstate 'PT404' using message='item_not_found';
        end if;
        return (select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x) order by x.serial),'[]'))
            from (select s.serial,s.item_id,s.receipt_id from solar_private.stock_serials s where s.item_id=item
                and (after_serial is null or s.serial>after_serial) and not exists(
                    select 1 from solar_private.shipment_serials x where x.serial=s.serial) order by s.serial limit 50) x);
    end if;
    if resource in ('warranties','warranty') then
        if a.role not in ('admin','inventory','technician','customer') then raise sqlstate 'PT403' using message='forbidden'; end if;
        if resource='warranty' and target is null then raise sqlstate 'PT404' using message='warranty_not_found'; end if;
        if serial_filter is not null and not solar_private.valid_serial(serial_filter) then
            raise sqlstate 'PT400' using message='invalid_serial';
        end if;
        select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]')) into result
        from (select w.id,w.serial,x.item_id,s.name,p.id as order_id,'ORD-'||p.id as order_reference,p.work_id as work_order_id,
                w.term_months,w.starts_on,w.expires_on,p.delivered_at,
                case when (now() at time zone 'Asia/Kolkata')::date < w.expires_on then 'active' else 'expired' end as state
            from solar_private.warranties w join solar_private.shipment_serials x using(serial)
            join solar_private.stock_items s using(item_id) join solar_private.stock_movements m on m.id=x.movement_id
            join solar_private.fulfilment_projects p on p.shipment_id=m.shipment_id
            where (target is null or w.id=target) and (after_id is null or w.id>after_id)
                and (serial_filter is null or w.serial=serial_filter)
                and solar_private.project_visible(a.id,a.role,p.customer_id,p.technician_id,p.salesperson_id)
            order by w.id limit 50) rows;
        if resource='warranties' then return result; end if;
        if result#>'{items,0}' is null then raise sqlstate 'PT404' using message='warranty_not_found'; end if;
        return result#>'{items,0}';
    end if;
    if resource='projects' then
        return (select jsonb_build_object('items',coalesce(jsonb_agg(rows.detail order by rows.id),'[]'))
            from (select p0.id,solar_private.project_summary(p0) as detail from solar_private.fulfilment_projects p0
                where (after_id is null or p0.id>after_id)
                    and solar_private.project_visible(a.id,a.role,p0.customer_id,p0.technician_id,p0.salesperson_id)
                order by p0.id limit 50) rows);
    end if;
    select * into project from solar_private.fulfilment_projects p0
    where (case resource when 'project' then p0.id=target when 'installation' then p0.work_id=target else false end)
        and solar_private.project_visible(a.id,a.role,p0.customer_id,p0.technician_id,p0.salesperson_id);
    if not found then raise sqlstate 'PT404' using message='project_not_found'; end if;
    return solar_private.project_detail(project,a.role);
end $$;

create function solar_private.fulfilment_command(cmd text,target uuid,k uuid,body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb; command_name text:='fulfilment_'||cmd;
begin
    case cmd
        when 'receive','dispatch','deliver' then actor:=solar_private.require_role(array['inventory']);
        when 'schedule' then actor:=solar_private.require_role(array['admin']);
        when 'report' then
            actor:=solar_private.require_role(array['technician']);
            perform 1 from solar_private.installation_work_orders w where w.id=target and w.technician_id=actor for update;
            if not found then raise sqlstate 'PT404' using message='work_order_not_found'; end if;
        when 'signoff' then actor:=solar_private.require_role(array['customer']);
        else raise sqlstate 'PT404' using message='not_found';
    end case;
    result:=solar_private.replay(actor,k,command_name,target,body);
    if result is not null then return result; end if;
    case cmd
        when 'receive' then result:=solar_private.receive_stock(actor,body);
        when 'dispatch' then result:=solar_private.dispatch_stock(actor,target,body);
        when 'deliver' then result:=solar_private.deliver_shipment(actor,target,body);
        when 'schedule' then result:=solar_private.schedule_installation(actor,target,body);
        when 'report' then result:=solar_private.record_installation(actor,target,body);
        when 'signoff' then result:=solar_private.signoff_installation(actor,target,body);
    end case;
    return solar_private.remember(actor,k,command_name,target,body,result);
end $$;

revoke all on function solar_private.project_visible(uuid,text,uuid,uuid,uuid),solar_private.evidence_work(text),
    solar_private.require_role(text[]),solar_private.valid_serial(text),solar_private.serial_list(jsonb,integer),
    solar_private.receive_stock(uuid,jsonb),solar_private.shipment_view(solar_private.shipments),
    solar_private.dispatch_stock(uuid,uuid,jsonb),solar_private.deliver_shipment(uuid,uuid,jsonb),
    solar_private.schedule_installation(uuid,uuid,jsonb),solar_private.report_view(solar_private.installation_reports),
    solar_private.record_installation(uuid,uuid,jsonb),solar_private.signoff_installation(uuid,uuid,jsonb),
    solar_private.project_summary(solar_private.fulfilment_projects),solar_private.project_detail(solar_private.fulfilment_projects,text)
from public,anon,authenticated,service_role;

create function public.solar_fulfilment_read(resource text,target uuid,after_id uuid,item text,serial_filter text,after_serial text)
returns jsonb language sql stable security invoker set search_path='' as $$
    select solar_private.fulfilment_read($1,$2,$3,$4,$5,$6)
$$;
create function public.solar_fulfilment_command(cmd text,target uuid,k uuid,body jsonb)
returns jsonb language sql security invoker set search_path='' as $$
    select solar_private.fulfilment_command($1,$2,$3,$4)
$$;
revoke all on function public.solar_fulfilment_read(text,uuid,uuid,text,text,text),
    solar_private.fulfilment_read(text,uuid,uuid,text,text,text),public.solar_fulfilment_command(text,uuid,uuid,jsonb),
    solar_private.fulfilment_command(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.solar_fulfilment_read(text,uuid,uuid,text,text,text),
    solar_private.fulfilment_read(text,uuid,uuid,text,text,text),public.solar_fulfilment_command(text,uuid,uuid,jsonb),
    solar_private.fulfilment_command(text,uuid,uuid,jsonb) to authenticated;
