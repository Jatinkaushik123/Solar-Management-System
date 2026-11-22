create table solar_private.staff_disables (
    user_id uuid primary key references public.solar_profiles,
    disabled_by uuid not null references public.solar_profiles,
    disabled_at timestamptz not null default now()
);
alter table solar_private.staff_disables enable row level security;
revoke all on solar_private.staff_disables from public,anon,authenticated,service_role;

create function solar_private.disable_staff(target uuid,body jsonb,k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; result jsonb;
begin
    select * into a from solar_private.actor();
    if not found then raise sqlstate 'PT401' using message='unauthenticated'; end if;
    if a.role<>'admin' then raise sqlstate 'PT403' using message='forbidden'; end if;
    if target=a.id then raise sqlstate 'PT409' using message='cannot_disable_self'; end if;
    perform solar_private.fields(body,array[]::text[]);
    result:=solar_private.replay(a.id,k,'disable',target,body);
    if result is not null then return result; end if;
    perform 1 from solar_private.staff_assignments where user_id=target for update;
    if not found then raise sqlstate 'PT404' using message='staff_not_found'; end if;
    update auth.users set banned_until=timestamptz '9999-12-31 00:00:00+00' where id=target;
    insert into solar_private.staff_disables(user_id,disabled_by) values(target,a.id) on conflict(user_id) do nothing;
    select to_jsonb(d) into result from solar_private.staff_disables d where d.user_id=target;
    return solar_private.remember(a.id,k,'disable',target,body,result);
end $$;
create function public.solar_disable_staff(target uuid,body jsonb,k uuid) returns jsonb
language sql security invoker set search_path='' as $$select solar_private.disable_staff(target,body,k)$$;
revoke all on function public.solar_disable_staff(uuid,jsonb,uuid),solar_private.disable_staff(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.solar_disable_staff(uuid,jsonb,uuid),solar_private.disable_staff(uuid,jsonb,uuid) to authenticated;
