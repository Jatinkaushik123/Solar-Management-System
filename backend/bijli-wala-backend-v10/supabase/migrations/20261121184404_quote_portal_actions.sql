-- Use the same quote-state rules on the enquiry screen and the quote detail.
create function solar_private.quote_actions(q solar_private.quotes,role_name text) returns text[]
language sql stable set search_path='' as $$
    select case
        when role_name='sales' and q.state='draft' then
            case when q.price_version>0 and q.valid_until>=(now() at time zone 'Asia/Kolkata')::date
                then array['pricing','issue'] else array['pricing'] end
        when role_name='customer' and q.state='issued' and q.valid_until>=(now() at time zone 'Asia/Kolkata')::date
            then array['accept','decline','request_changes']
        else array[]::text[] end
$$;
create or replace function solar_private.actions(e solar_private.enquiries,role_name text) returns text[]
language sql stable set search_path='' as $$
    select case
        when e.state in ('accepted','declined') then array[]::text[]
        when role_name='admin' then array['assignment']
        when role_name='technician' then array['return','designs']
        when role_name='inventory' and e.state in ('technical_approved','shortage') then array['inventory-checks']
        when role_name='sales' and e.state='draft' then coalesce((select solar_private.quote_actions(q,role_name)
            from solar_private.quotes q where q.enquiry_id=e.id and q.state='draft'),array[]::text[])
        when role_name='customer' and e.state='issued' and exists(select 1 from solar_private.quotes q
            where q.enquiry_id=e.id and q.state='issued' and cardinality(solar_private.quote_actions(q,role_name))>0) then array['decision']
        else array[]::text[] end
$$;
create or replace function solar_private.quote_base(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a record; q solar_private.quotes; e solar_private.enquiries; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    select * into q from solar_private.quotes where id=target;
    select * into e from solar_private.enquiries where id=q.enquiry_id;
    if q.id is null or not coalesce(solar_private.quote_visible(q,e,a.id,a.role),false) then raise sqlstate 'PT404' using message='quote_not_found'; end if;
    result:=to_jsonb(q)||jsonb_build_object('allowed_actions',solar_private.quote_actions(q,a.role));
    if a.role='customer' then result:=result-array['stock_check_id','issued_by','decided_by']; end if;
    return result;
end $$;

create function solar_private.assignees() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a record;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if a.role<>'admin' then raise sqlstate 'PT403' using message='forbidden'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'role',sa.role)
        order by sa.role,p.display_name,p.id),'[]')
        from solar_private.staff_assignments sa join public.solar_profiles p on p.id=sa.user_id
        join auth.users u on u.id=p.id where sa.role in ('technician','sales')
        and (u.banned_until is null or u.banned_until<=now()));
end $$;
create function public.solar_assignees() returns jsonb
language sql security invoker set search_path='' as $$select solar_private.assignees()$$;
revoke all on function solar_private.quote_actions(solar_private.quotes,text) from public,anon,authenticated,service_role;
revoke all on function solar_private.assignees(),public.solar_assignees() from public,anon,authenticated,service_role;
grant execute on function solar_private.assignees(),public.solar_assignees() to authenticated;
