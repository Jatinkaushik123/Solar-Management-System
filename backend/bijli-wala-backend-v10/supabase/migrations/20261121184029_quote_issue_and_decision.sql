create table solar_private.quote_emails (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null unique references solar_private.quotes,
    recipient text not null,
    message jsonb not null,
    status text not null default 'pending' check(status in ('pending','sent','cancelled')),
    queued_at timestamptz not null default now()
);
alter table solar_private.quote_emails enable row level security;
revoke all on solar_private.quote_emails from public,anon,authenticated,service_role;

create function solar_private.freeze_issued_quote() returns trigger
language plpgsql set search_path='' as $$
begin
    if old.issued_at is not null and
        (to_jsonb(new)-array['state','decided_at','decided_by','decision_reason']) is distinct from
        (to_jsonb(old)-array['state','decided_at','decided_by','decision_reason']) then
        raise sqlstate 'PT409' using message='quote_frozen';
    end if;
    return new;
end $$;
create trigger freeze_issued_quote before update on solar_private.quotes
for each row execute function solar_private.freeze_issued_quote();

alter function solar_private.quote_view(uuid) rename to quote_base;
create function solar_private.quote_view(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; delivery jsonb;
begin
    result:=solar_private.quote_base(target);
    if (select role from solar_private.actor()) in ('admin','sales') then
        select jsonb_build_object('id',id,'status',status,'queued_at',queued_at,'recipient',recipient)
        into delivery from solar_private.quote_emails where quote_id=target;
        result:=result||jsonb_build_object('delivery',delivery);
    end if;
    return result;
end $$;

create function solar_private.price_quote(q solar_private.quotes,body jsonb) returns void
language plpgsql set search_path='' as $$
declare prices jsonb:=body->'unit_prices'; line jsonb; priced_lines jsonb:='[]'; unit_price bigint;
    subtotal numeric:=0; installation bigint; discount bigint; total numeric; advance bigint; rule_value bigint;
    kind text; validity date; item_key text;
begin
    perform solar_private.fields(body,array['price_version','unit_prices','installation_paise','discount_paise','valid_until','advance_kind','advance_value']);
    if jsonb_typeof(prices) is distinct from 'object' then raise sqlstate 'PT400' using message='invalid_price_map'; end if;
    perform solar_private.fields(prices,array(select x->>'item_id' from jsonb_array_elements(q.lines) x));
    for line in select value from jsonb_array_elements(q.lines) loop
        item_key:=line->>'item_id';
        unit_price:=solar_private.amount(prices,item_key,0,100000000000);
        priced_lines:=priced_lines||jsonb_build_array(line||jsonb_build_object('unit_paise',unit_price));
        subtotal:=subtotal+unit_price*(line->>'quantity')::integer;
    end loop;
    installation:=solar_private.amount(body,'installation_paise',0,100000000000);
    discount:=solar_private.amount(body,'discount_paise',0,100000000000);
    total:=subtotal+installation-discount;
    if total not between 1 and 1000000000000 then raise sqlstate 'PT400' using message='invalid_total'; end if;
    validity:=solar_private.text_field(body,'valid_until',10)::date;
    if not isfinite(validity) or body->>'valid_until'<>to_char(validity,'YYYY-MM-DD') or validity<(now() at time zone 'Asia/Kolkata')::date then
        raise sqlstate 'PT400' using message='invalid_validity'; end if;
    kind:=body->>'advance_kind';
    if kind='fixed' then
        rule_value:=solar_private.amount(body,'advance_value',1,total);
        advance:=rule_value;
    elsif kind='percentage' then
        rule_value:=solar_private.amount(body,'advance_value',1,10000);
        advance:=round(total*rule_value/10000);
        if advance<1 then raise sqlstate 'PT400' using message='advance_too_small'; end if;
    else raise sqlstate 'PT400' using message='invalid_advance_kind'; end if;
    update solar_private.quotes set lines=priced_lines,price_version=price_version+1,discount_paise=discount,
        installation_paise=installation,valid_until=validity,advance_kind=kind,advance_value=rule_value,total_paise=total,advance_paise=advance
        where id=q.id;
end $$;
create function solar_private.issue_quote(e solar_private.enquiries,q solar_private.quotes,actor uuid) returns void
language plpgsql set search_path='' as $$
begin
    if q.issued_at is not null then return; end if;
    if q.state<>'draft' or e.state<>'draft' or q.design_revision<>e.revision or q.price_version=0 then
        raise sqlstate 'PT409' using message='quote_not_ready'; end if;
    if q.valid_until<(now() at time zone 'Asia/Kolkata')::date then raise sqlstate 'PT409' using message='quote_expired'; end if;
    if not exists(select 1 from auth.users where id=e.customer_id and email_confirmed_at is not null and lower(email)=e.recipient_email) then
        raise sqlstate 'PT409' using message='recipient_verification_required'; end if;
    update solar_private.quotes set state='issued',issued_at=now(),issued_by=actor,recipient_email=e.recipient_email
        where id=q.id returning * into q;
    insert into solar_private.quote_emails(quote_id,recipient,message) values(q.id,q.recipient_email,jsonb_build_object(
        'template','issued_quote','portal_path','/v1/quotes/'||q.id,'quote_id',q.id,'quote_revision',q.revision,
        'request_reference','ENQ-'||e.serial_no,'design_revision',q.design_revision,'lines',q.lines,
        'discount_paise',q.discount_paise,'installation_paise',q.installation_paise,'valid_until',q.valid_until,
        'advance_kind',q.advance_kind,'advance_value',q.advance_value,'total_paise',q.total_paise,'advance_paise',q.advance_paise,'currency',q.currency));
    update solar_private.enquiries set state='issued' where id=e.id;
    perform solar_private.event(e,actor,'quote_issued',jsonb_build_object('quote_id',q.id,'quote_revision',q.revision));
end $$;
create function solar_private.decide_quote(e solar_private.enquiries,q solar_private.quotes,actor uuid,body jsonb) returns void
language plpgsql set search_path='' as $$
declare choice text:=body->>'decision'; destination text; why text; kind text; next_quote uuid;
begin
    if choice='request_changes' then
        perform solar_private.fields(body,array['decision','kind','reason']);
        kind:=body->>'kind';
        if kind not in('technical','commercial') then raise sqlstate 'PT400' using message='invalid_change_kind'; end if;
        why:=solar_private.text_field(body,'reason',1500);
        destination:='changes_requested';
    elsif choice in ('accept','decline') then
        perform solar_private.fields(body,array['decision']);
        destination:=case when choice='accept' then 'accepted' else 'declined' end;
    else raise sqlstate 'PT400' using message='invalid_decision'; end if;
    if q.state=destination and choice in ('accept','decline') then return; end if;
    if q.state<>'issued' or e.state<>'issued' or e.revision<>q.design_revision then raise sqlstate 'PT409' using message='quote_not_current'; end if;
    if q.valid_until<(now() at time zone 'Asia/Kolkata')::date then raise sqlstate 'PT409' using message='quote_expired'; end if;
    update solar_private.quotes set state=destination,decided_at=now(),decided_by=actor,decision_reason=why where id=q.id;
    if kind='commercial' then
        next_quote:=solar_private.make_draft(e,q.stock_check_id);
        update solar_private.quotes set lines=q.lines,installation_paise=q.installation_paise,discount_paise=q.discount_paise
            where id=next_quote;
    end if;
    update solar_private.enquiries set state=case when kind='commercial' then 'draft' else destination end where id=e.id;
    perform solar_private.event(e,actor,destination,jsonb_strip_nulls(jsonb_build_object('quote_id',q.id,'quote_revision',q.revision,'kind',kind,'reason',why)));
end $$;
create function solar_private.quote_command(target uuid, action text, body jsonb,k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; e solar_private.enquiries; q solar_private.quotes; result jsonb; expected_version int;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if not coalesce(case when action in('pricing','issue') then a.role='sales' when action='decision' then a.role='customer' else false end,false) then
        raise sqlstate 'PT403' using message='forbidden'; end if;
    -- All competing actions lock the parent first, including design revisions.
    select p.* into e from solar_private.enquiries p join solar_private.quotes v on v.enquiry_id=p.id where v.id=target for update of p;
    select * into q from solar_private.quotes where id=target;
    if not found or not coalesce(solar_private.quote_visible(q,e,a.id,a.role),false) then raise sqlstate 'PT404' using message='quote_not_found'; end if;
    result:=solar_private.replay(a.id,k,action,target,body);
    if result is not null then return result; end if;
    if action in ('pricing','issue') then
        expected_version:=solar_private.amount(body,'price_version',0,2147483646);
        if expected_version<>q.price_version then raise sqlstate 'PT409' using message='stale_price'; end if;
    end if;
    case action
    when 'pricing' then
        if q.state<>'draft' or e.state<>'draft' or e.revision<>q.design_revision then raise sqlstate 'PT409' using message='quote_frozen'; end if;
        perform solar_private.price_quote(q,body);
        perform solar_private.event(e,a.id,'quote_priced',jsonb_build_object('quote_id',q.id,'price_version',q.price_version+1));
    when 'issue' then
        perform solar_private.fields(body,array['price_version']);
        perform solar_private.issue_quote(e,q,a.id);
    when 'decision' then perform solar_private.decide_quote(e,q,a.id,body);
    end case;
    return solar_private.remember(a.id,k,action,target,body,solar_private.quote_view(target));
end $$;
create or replace function public.solar_quote(target uuid) returns jsonb language sql security invoker set search_path='' as $$select solar_private.quote_view(target)$$;
create function public.solar_quote_command(target uuid,action text,body jsonb,k uuid) returns jsonb
language sql security invoker set search_path='' as $$select solar_private.quote_command(target,action,body,k)$$;
revoke all on function solar_private.price_quote(solar_private.quotes,jsonb),solar_private.issue_quote(solar_private.enquiries,solar_private.quotes,uuid),
    solar_private.decide_quote(solar_private.enquiries,solar_private.quotes,uuid,jsonb),solar_private.freeze_issued_quote(),solar_private.quote_base(uuid)
    from public,anon,authenticated,service_role;
revoke all on function solar_private.quote_view(uuid),solar_private.quote_command(uuid,text,jsonb,uuid),public.solar_quote_command(uuid,text,jsonb,uuid)
    from public,anon,authenticated,service_role;
grant execute on function solar_private.quote_view(uuid),solar_private.quote_command(uuid,text,jsonb,uuid),public.solar_quote_command(uuid,text,jsonb,uuid) to authenticated;
