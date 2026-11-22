create table solar_private.sites (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.solar_profiles,
    address text not null,
    unique (id, owner_id)
);
create table solar_private.enquiries (
    id uuid primary key default gen_random_uuid(),
    serial_no bigint generated always as identity unique,
    customer_id uuid not null references public.solar_profiles,
    site_id uuid not null,
    contact_email text not null,
    recipient_email text not null,
    requirements text not null,
    roof_space_m2 numeric(10,2) not null check (roof_space_m2 > 0),
    monthly_bill_paise bigint not null check (monthly_bill_paise >= 0),
    grid_details text not null,
    technician_id uuid references public.solar_profiles,
    salesperson_id uuid references public.solar_profiles,
    revision integer not null default 0,
    state text not null default 'submitted' check (state in ('submitted','assigned','correction','technical_approved','shortage','draft','issued','changes_requested','accepted','declined')),
    created_at timestamptz not null default now(),
    foreign key (site_id,customer_id) references solar_private.sites(id,owner_id)
);
create index enquiries_owner_idx on solar_private.enquiries(customer_id,serial_no);
create index enquiries_tech_idx on solar_private.enquiries(technician_id,serial_no);
create index enquiries_sales_idx on solar_private.enquiries(salesperson_id,serial_no);
create table solar_private.workflow_events (
    seq bigint generated always as identity primary key,
    enquiry_id uuid not null references solar_private.enquiries,
    revision integer not null,
    action text not null,
    actor_id uuid not null references public.solar_profiles,
    at timestamptz not null default now(),
    detail jsonb not null default '{}'
);
create index workflow_events_enquiry_idx on solar_private.workflow_events(enquiry_id,seq);
create table solar_private.workflow_retries (
    actor_id uuid not null references public.solar_profiles,
    request_key uuid not null,
    command text not null,
    target uuid,
    body jsonb not null,
    result jsonb not null,
    primary key(actor_id, request_key)
);
alter table solar_private.sites enable row level security;
alter table solar_private.enquiries enable row level security;
alter table solar_private.workflow_events enable row level security;
alter table solar_private.workflow_retries enable row level security;
revoke all on solar_private.sites, solar_private.enquiries, solar_private.workflow_events,
    solar_private.workflow_retries from public, anon, authenticated, service_role;

create function solar_private.fields(body jsonb, required text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
    if jsonb_typeof(body) is distinct from 'object' or not (body ?& required)
       or body - required <> '{}'::jsonb or exists (select 1 from jsonb_each(body) x where x.value='null'::jsonb) then
        raise sqlstate 'PT400' using message='invalid_fields';
    end if;
end $$;
create function solar_private.text_field(body jsonb, field text, max_length int) returns text
language plpgsql immutable set search_path='' as $$
declare v text := btrim(body->>field);
begin
    if jsonb_typeof(body->field) is distinct from 'string' or char_length(v) not between 1 and max_length then
        raise sqlstate 'PT400' using message='invalid_text';
    end if;
    return v;
end $$;
create function solar_private.amount(body jsonb, field text, lo numeric, hi numeric, decimals int default 0) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
    if jsonb_typeof(body->field) is distinct from 'number' then raise sqlstate 'PT400' using message='invalid_number'; end if;
    n := (body->>field)::numeric;
    if n <> round(n,decimals) or n not between lo and hi then raise sqlstate 'PT400' using message='invalid_number'; end if;
    return n;
end $$;

-- Only trusted operation functions call these helpers. The transaction lock also
-- covers competing retries when the original insert has not yet committed.
create function solar_private.replay(actor uuid, k uuid, cmd text, target_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare prior solar_private.workflow_retries;
begin
    if k is null then raise sqlstate 'PT400' using message='idempotency_key_required'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text || k::text, 0));
    select * into prior from solar_private.workflow_retries where actor_id=actor and request_key=k;
    if found then
        if (prior.command,prior.target,prior.body) is distinct from (cmd,target_id,payload) then
            raise sqlstate 'PT409' using message='idempotency_conflict';
        end if;
        return prior.result;
    end if;
    return null;
end $$;
create function solar_private.remember(actor uuid,k uuid,cmd text,target uuid,body jsonb,result jsonb) returns jsonb
language sql set search_path='' as $$
    insert into solar_private.workflow_retries values ($1,$2,$3,$4,$5,$6) returning workflow_retries.result
$$;

create function solar_private.enquiry_visible(e solar_private.enquiries, actor uuid, role_name text)
returns boolean language sql immutable set search_path='' as $$
    select case role_name when 'customer' then e.customer_id=actor when 'admin' then true
        when 'technician' then e.technician_id=actor when 'sales' then e.salesperson_id=actor
        when 'inventory' then e.revision>0 else false end
$$;
create function solar_private.enquiry_summary(e solar_private.enquiries) returns jsonb
language sql immutable set search_path='' as $$
    select jsonb_build_object('id',e.id,'reference','ENQ-'||e.serial_no,'state',e.state,'revision',e.revision,'created_at',e.created_at)
$$;

create function solar_private.intake(body jsonb,k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; site uuid; e solar_private.enquiries; result jsonb; email text;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if a.role <> 'customer' then raise sqlstate 'PT403' using message='forbidden'; end if;
    result := solar_private.replay(a.id,k,'intake',null,body);
    if result is not null then return result; end if;
    perform solar_private.fields(body,array['site','contact_email','requirements','roof_space_m2','monthly_bill_paise','grid_details']);
    email := lower(solar_private.text_field(body,'contact_email',254));
    if email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise sqlstate 'PT400' using message='invalid_email'; end if;
    insert into solar_private.sites(owner_id,address) values(a.id,solar_private.text_field(body,'site',600)) returning id into site;
    insert into solar_private.enquiries(customer_id,site_id,contact_email,recipient_email,requirements,roof_space_m2,monthly_bill_paise,grid_details)
    values(a.id,site,email,lower(a.email),solar_private.text_field(body,'requirements',2000),
        solar_private.amount(body,'roof_space_m2',0.01,1000000,2),solar_private.amount(body,'monthly_bill_paise',0,100000000000),
        solar_private.text_field(body,'grid_details',1200)) returning * into e;
    insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id) values(e.id,0,'submitted',a.id);
    result := solar_private.enquiry_summary(e) || jsonb_build_object('acknowledgement','We’ve received your request. We’ll email your quotation once it’s approved.');
    return solar_private.remember(a.id,k,'intake',null,body,result);
end $$;

create function solar_private.read_enquiry(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e solar_private.enquiries; a record; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    select * into e from solar_private.enquiries where id=target;
    if not found or not coalesce(solar_private.enquiry_visible(e,a.id,a.role),false) then raise sqlstate 'PT404' using message='enquiry_not_found'; end if;
    result := solar_private.enquiry_summary(e);
    if a.role <> 'inventory' then
        result := result || jsonb_build_object('site',(select address from solar_private.sites where id=e.site_id),
            'site_id',e.site_id,'contact_email',e.contact_email,'recipient_email',e.recipient_email,'requirements',e.requirements,
            'roof_space_m2',e.roof_space_m2,'monthly_bill_paise',e.monthly_bill_paise,'grid_details',e.grid_details,
            'technician_id',e.technician_id,'salesperson_id',e.salesperson_id);
    end if;
    return result;
end $$;
create function public.solar_intake(body jsonb,k uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.intake(body,k)$$;
create function public.solar_enquiry(target uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.read_enquiry(target)$$;
revoke all on all functions in schema solar_private from public,anon;
revoke all on function public.solar_intake(jsonb,uuid),public.solar_enquiry(uuid) from public,anon,service_role;
grant execute on function solar_private.intake(jsonb,uuid),solar_private.read_enquiry(uuid),public.solar_intake(jsonb,uuid),public.solar_enquiry(uuid) to authenticated;
revoke all on function solar_private.replay(uuid,uuid,text,uuid,jsonb), solar_private.remember(uuid,uuid,text,uuid,jsonb,jsonb),
    solar_private.fields(jsonb,text[]), solar_private.amount(jsonb,text,numeric,numeric,int),
    solar_private.text_field(jsonb,text,int), solar_private.enquiry_visible(solar_private.enquiries,uuid,text),
    solar_private.enquiry_summary(solar_private.enquiries) from authenticated,service_role;
