create table solar_private.stock_items (
    item_id text primary key,
    name text not null,
    available integer not null check(available >= 0),
    suggested_unit_paise bigint not null check(suggested_unit_paise > 0)
);
insert into solar_private.stock_items values
    ('DEMO-PANEL','Demo 550 W rooftop panel',40,2000000),
    ('DEMO-INVERTER','Demo grid-tied inverter',6,5000000),
    ('DEMO-BATTERY','Demo battery (out of stock)',0,3000000);
create table solar_private.designs (
    enquiry_id uuid not null references solar_private.enquiries,
    revision integer not null check(revision>0),
    visited_at timestamptz not null,
    roof_direction text not null,
    tilt_deg numeric(5,2) not null check(tilt_deg between 0 and 90),
    cable_m numeric(10,2) not null check(cable_m>=0),
    approved_by uuid not null references public.solar_profiles,
    approved_at timestamptz not null default now(),
    primary key(enquiry_id,revision)
);
create table solar_private.equipment_lines (
    enquiry_id uuid not null,
    revision integer not null,
    item_id text not null references solar_private.stock_items,
    quantity integer not null check(quantity between 1 and 10000),
    primary key(enquiry_id,revision,item_id),
    foreign key(enquiry_id,revision) references solar_private.designs
);
create table solar_private.stock_checks (
    id uuid primary key default gen_random_uuid(),
    enquiry_id uuid not null,
    revision integer not null,
    actor_id uuid not null references public.solar_profiles,
    checked_at timestamptz not null default now(),
    outcome text not null check(outcome in ('approved','shortage')),
    lines jsonb not null,
    foreign key(enquiry_id,revision) references solar_private.designs,
    unique(id,enquiry_id,revision)
);
create index stock_checks_revision_idx on solar_private.stock_checks(enquiry_id,revision,checked_at);
create unique index one_stock_approval on solar_private.stock_checks(enquiry_id,revision) where outcome='approved';
create table solar_private.quotes (
    id uuid primary key default gen_random_uuid(),
    enquiry_id uuid not null,
    design_revision integer not null,
    stock_check_id uuid not null,
    revision integer not null,
    state text not null default 'draft' check(state in ('draft','issued','superseded','accepted','declined','changes_requested')),
    lines jsonb not null,
    price_version integer not null default 0,
    discount_paise bigint not null default 0,
    installation_paise bigint not null default 0,
    valid_until date,
    advance_kind text check(advance_kind in ('fixed','percentage')),
    advance_value bigint,
    total_paise bigint,
    advance_paise bigint,
    currency text not null default 'INR' check(currency='INR'),
    recipient_email text,
    issued_at timestamptz,
    issued_by uuid references public.solar_profiles,
    decided_at timestamptz,
    decided_by uuid references public.solar_profiles,
    decision_reason text,
    unique(enquiry_id,revision),
    foreign key(stock_check_id,enquiry_id,design_revision) references solar_private.stock_checks(id,enquiry_id,revision)
);
create unique index one_live_quote on solar_private.quotes(enquiry_id) where state in('draft','issued','accepted');
alter table solar_private.stock_items enable row level security;
alter table solar_private.designs enable row level security;
alter table solar_private.equipment_lines enable row level security;
alter table solar_private.stock_checks enable row level security;
alter table solar_private.quotes enable row level security;
revoke all on solar_private.stock_items,solar_private.designs,solar_private.equipment_lines,
    solar_private.stock_checks,solar_private.quotes from public,anon,authenticated,service_role;

create function solar_private.event(e solar_private.enquiries, actor uuid, action text, detail jsonb default '{}') returns void
language sql set search_path='' as $$
    insert into solar_private.workflow_events(enquiry_id,revision,actor_id,action,detail) values(e.id,e.revision,actor,action,detail)
$$;
create function solar_private.make_draft(e solar_private.enquiries, check_id uuid) returns uuid
language plpgsql set search_path='' as $$
declare quote_id uuid;
begin
    insert into solar_private.quotes(enquiry_id,design_revision,stock_check_id,revision,lines)
    select e.id,e.revision,c.id,(select coalesce(max(q.revision),0)+1 from solar_private.quotes q where q.enquiry_id=e.id),
        (select jsonb_agg(jsonb_build_object('item_id',s.item_id,'name',s.name,'quantity',l.quantity,
            'unit_paise',s.suggested_unit_paise) order by s.item_id)
         from solar_private.equipment_lines l join solar_private.stock_items s using(item_id)
         where l.enquiry_id=e.id and l.revision=e.revision)
    from solar_private.stock_checks c where c.id=check_id and c.enquiry_id=e.id and c.revision=e.revision and c.outcome='approved'
    returning id into strict quote_id;
    return quote_id;
end $$;
create function solar_private.approve_design(e solar_private.enquiries,actor uuid,body jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb; item_key text; visited timestamptz; direction text;
begin
    perform solar_private.fields(body,array['base_revision','visited_at','roof_direction','tilt_deg','cable_m','equipment']);
    if jsonb_typeof(body->'equipment') <> 'array' or jsonb_array_length(body->'equipment') not between 1 and 100 then
        raise sqlstate 'PT400' using message='invalid_equipment';
    end if;
    visited := solar_private.text_field(body,'visited_at',40)::timestamptz;
    if not isfinite(visited) or visited>clock_timestamp() then raise sqlstate 'PT400' using message='invalid_visit'; end if;
    direction := solar_private.text_field(body,'roof_direction',20);
    if lower(direction) not in ('north','north-east','east','south-east','south','south-west','west','north-west') then
        raise sqlstate 'PT400' using message='invalid_direction'; end if;
    insert into solar_private.designs values(e.id,e.revision,visited,direction,
        solar_private.amount(body,'tilt_deg',0,90,2),solar_private.amount(body,'cable_m',0,100000,2),actor,now());
    for item in select value from jsonb_array_elements(body->'equipment') loop
        perform solar_private.fields(item,array['item_id','quantity']);
        item_key := solar_private.text_field(item,'item_id',100);
        if not exists(select 1 from solar_private.stock_items where item_id=item_key) then
            raise sqlstate 'PT400' using message='unknown_item';
        end if;
        insert into solar_private.equipment_lines values(e.id,e.revision,item_key,solar_private.amount(item,'quantity',1,10000));
    end loop;
exception when unique_violation then raise sqlstate 'PT400' using message='duplicate_equipment';
end $$;
create function solar_private.check_inventory(e solar_private.enquiries,actor uuid) returns jsonb
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
        into sufficient,available_lines from solar_private.equipment_lines l join solar_private.stock_items s using(item_id)
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

create function solar_private.review(target uuid, action text, body jsonb, k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; e solar_private.enquiries; result jsonb; tech uuid; sales uuid; reason text;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if not coalesce(case action when 'assignment' then a.role='admin' when 'designs' then a.role='technician'
        when 'return' then a.role='technician' when 'inventory-checks' then a.role='inventory' else false end,false) then
        raise sqlstate 'PT403' using message='forbidden';
    end if;
    select * into e from solar_private.enquiries where id=target for update;
    if not found or not coalesce(solar_private.enquiry_visible(e,a.id,a.role),false) then raise sqlstate 'PT404' using message='enquiry_not_found'; end if;
    result:=solar_private.replay(a.id,k,action,target,body);
    if result is not null then return result; end if;
    if e.state in ('accepted','declined') then raise sqlstate 'PT409' using message='request_closed'; end if;
    case action
    when 'assignment' then
        perform solar_private.fields(body,array['technician_id','salesperson_id']);
        tech:=(body->>'technician_id')::uuid; sales:=(body->>'salesperson_id')::uuid;
        if (select count(*) from solar_private.staff_assignments sa join auth.users u on u.id=sa.user_id
            where (u.banned_until is null or u.banned_until<=now()) and ((sa.user_id=tech and sa.role='technician')
               or (sa.user_id=sales and sa.role='sales'))) <> 2 then raise sqlstate 'PT400' using message='invalid_assignees'; end if;
        update solar_private.enquiries set technician_id=tech,salesperson_id=sales,state=case when state='submitted' then 'assigned' else state end
        where id=e.id returning * into e;
        perform solar_private.event(e,a.id,'assigned',body);
    when 'inventory-checks' then
        perform solar_private.fields(body,array['revision']);
        if solar_private.amount(body,'revision',1,2147483647) <> e.revision then raise sqlstate 'PT409' using message='stale_design'; end if;
        if e.state='correction' or e.state='changes_requested' then raise sqlstate 'PT409' using message='technical_approval_required'; end if;
        result:=solar_private.check_inventory(e,a.id);
    else
        if solar_private.amount(body,'base_revision',0,2147483646) <> e.revision then raise sqlstate 'PT409' using message='stale_design'; end if;
        update solar_private.quotes set state='superseded' where enquiry_id=e.id and state in ('draft','issued');
        if action='return' then
            perform solar_private.fields(body,array['base_revision','reason']);
            reason:=solar_private.text_field(body,'reason',1500);
            update solar_private.enquiries set state='correction' where id=e.id returning * into e;
            perform solar_private.event(e,a.id,'survey_returned',jsonb_build_object('reason',reason));
        else
            update solar_private.enquiries set state='technical_approved',revision=revision+1 where id=e.id returning * into e;
            perform solar_private.approve_design(e,a.id,body);
            perform solar_private.event(e,a.id,'technical_approved');
        end if;
    end case;
    return solar_private.remember(a.id,k,action,target,body,coalesce(result,solar_private.enquiry_summary(e)));
end $$;
create function solar_private.actions(e solar_private.enquiries, role_name text) returns text[]
language sql immutable set search_path='' as $$
    select case
        when e.state in ('accepted','declined') then array[]::text[]
        when role_name='admin' then array['assignment']
        when role_name='technician' then array['return','designs']
        when role_name='inventory' and e.state in ('technical_approved','shortage') then array['inventory-checks']
        when role_name='sales' and e.state='draft' then array['pricing','issue']
        when role_name='customer' and e.state='issued' then array['decision']
        else array[]::text[] end
$$;
create function solar_private.quote_visible(q solar_private.quotes,e solar_private.enquiries,actor uuid,role_name text)
returns boolean language sql immutable set search_path='' as $$
    select role_name='admin' or (role_name='sales' and e.salesperson_id=actor)
        or (role_name='customer' and e.customer_id=actor and q.issued_at is not null)
$$;
create function solar_private.quote_view(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a record; q solar_private.quotes; e solar_private.enquiries; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    select * into q from solar_private.quotes where id=target;
    select * into e from solar_private.enquiries where id=q.enquiry_id;
    if q.id is null or not coalesce(solar_private.quote_visible(q,e,a.id,a.role),false) then raise sqlstate 'PT404' using message='quote_not_found'; end if;
    result:=to_jsonb(q)||jsonb_build_object('allowed_actions',case when q.state='draft' and a.role='sales' then
        case when q.price_version>0 then array['pricing','issue'] else array['pricing'] end
        when q.state='issued' and a.role='customer' and q.valid_until >= (now() at time zone 'Asia/Kolkata')::date then array['accept','decline','request_changes'] else array[]::text[] end);
    if a.role='customer' then result:=result-array['stock_check_id','issued_by','decided_by']; end if;
    return result;
end $$;
alter function solar_private.read_enquiry(uuid) rename to enquiry_base;
create function solar_private.read_enquiry(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a record; e solar_private.enquiries; result jsonb; history jsonb; versions jsonb; designs jsonb;
begin
    result:=solar_private.enquiry_base(target);
    select * into strict a from solar_private.actor();
    select * into strict e from solar_private.enquiries where id=target;
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'revision',q.revision,'design_revision',q.design_revision,
        'state',q.state,'issued_at',q.issued_at) order by q.revision),'[]') into versions
    from solar_private.quotes q where q.enquiry_id=e.id and solar_private.quote_visible(q,e,a.id,a.role);
    select coalesce(jsonb_agg(case when a.role in('customer','inventory') then
        jsonb_build_object('action',v.action,'revision',v.revision,'at',v.at) ||
        case when v.action='survey_returned' then v.detail else '{}'::jsonb end
        else to_jsonb(v)-'enquiry_id' end order by v.seq),'[]') into history
    from solar_private.workflow_events v where v.enquiry_id=e.id and (a.role<>'customer'
        or v.action in ('submitted','assigned','survey_returned','technical_approved','quote_issued','accepted','declined','changes_requested'));
    if a.role='customer' and e.state in ('draft','shortage','technical_approved') then result:=result||'{"state":"under_review"}'::jsonb; end if;
    if a.role<>'customer' then
        select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('equipment',(
            select jsonb_agg(jsonb_build_object('item_id',l.item_id,'quantity',l.quantity) order by item_id)
            from solar_private.equipment_lines l where l.enquiry_id=d.enquiry_id and l.revision=d.revision)) order by d.revision),'[]') into designs
        from solar_private.designs d where d.enquiry_id=e.id;
        result:= result || jsonb_build_object('designs',designs,'stock_checks',(
            select coalesce(jsonb_agg(to_jsonb(c) order by checked_at,id),'[]') from solar_private.stock_checks c where c.enquiry_id=e.id));
    end if;
    return result||jsonb_build_object('quotes',versions,'history',history,'allowed_actions',solar_private.actions(e,a.role));
end $$;
create function solar_private.list_enquiries(after_serial bigint,page_size int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a record; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if after_serial is null or after_serial<0 or page_size is null or page_size not between 1 and 100 then raise sqlstate 'PT400' using message='invalid_page'; end if;
    select jsonb_build_object('items',coalesce(jsonb_agg(solar_private.enquiry_summary(e) ||
        case when a.role='customer' and e.state in ('draft','shortage','technical_approved') then '{"state":"under_review"}'::jsonb else '{}'::jsonb end
        order by e.serial_no),'[]'),'next_after',case when count(*)=page_size then max(e.serial_no) end)
    into result from (select * from solar_private.enquiries e where e.serial_no>after_serial and solar_private.enquiry_visible(e,a.id,a.role)
        order by e.serial_no limit page_size) e;
    return result;
end $$;
create function solar_private.demo_stock() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text;
begin
    select role into role_name from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if role_name not in ('admin','technician','inventory') then raise sqlstate 'PT403' using message='forbidden'; end if;
    return (select jsonb_agg(to_jsonb(s) order by item_id) from solar_private.stock_items s);
end $$;
create or replace function public.solar_enquiry(target uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.read_enquiry(target)$$;
create function public.solar_review(target uuid,action text,body jsonb,k uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.review(target,action,body,k)$$;
create function public.solar_quote(target uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.quote_view(target)$$;
create function public.solar_demo_stock() returns jsonb language sql security invoker set search_path='' as $$select solar_private.demo_stock()$$;
create function public.solar_enquiries(after_serial bigint,page_size int) returns jsonb language sql security invoker set search_path='' as $$select solar_private.list_enquiries(after_serial,page_size)$$;
revoke all on function solar_private.enquiry_base(uuid),solar_private.actions(solar_private.enquiries,text),solar_private.quote_visible(solar_private.quotes,solar_private.enquiries,uuid,text),
    solar_private.event(solar_private.enquiries,uuid,text,jsonb),solar_private.make_draft(solar_private.enquiries,uuid),
    solar_private.approve_design(solar_private.enquiries,uuid,jsonb),solar_private.check_inventory(solar_private.enquiries,uuid) from public,anon,authenticated,service_role;
revoke all on function solar_private.read_enquiry(uuid),solar_private.review(uuid,text,jsonb,uuid),solar_private.quote_view(uuid),solar_private.demo_stock(),
    solar_private.list_enquiries(bigint,int),public.solar_review(uuid,text,jsonb,uuid),public.solar_quote(uuid),
    public.solar_demo_stock(),public.solar_enquiries(bigint,int) from public,anon,authenticated,service_role;
grant execute on function solar_private.read_enquiry(uuid),solar_private.review(uuid,text,jsonb,uuid),solar_private.quote_view(uuid),solar_private.demo_stock(),
    solar_private.list_enquiries(bigint,int),public.solar_review(uuid,text,jsonb,uuid),public.solar_quote(uuid),
    public.solar_demo_stock(),public.solar_enquiries(bigint,int) to authenticated;
