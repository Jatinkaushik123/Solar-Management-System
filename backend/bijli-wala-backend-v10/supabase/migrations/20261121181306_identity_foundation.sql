create schema solar_private;
revoke all on schema solar_private from public, anon, authenticated, service_role;
grant usage on schema solar_private to authenticated;

create table public.solar_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(display_name) <= 120),
    created_at timestamptz not null default now()
);

create table solar_private.staff_assignments (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('technician', 'inventory', 'sales', 'admin')),
    assigned_by uuid references auth.users(id) on delete set null,
    assigned_at timestamptz not null default now()
);
create index staff_assignments_actor_idx on solar_private.staff_assignments (assigned_by);

create table solar_private.staff_invitations (
    email text primary key,
    role text not null check (role in ('technician', 'inventory', 'sales', 'admin')),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    invited_by uuid not null references auth.users(id) on delete cascade,
    expires_at timestamptz not null,
    accepted_by uuid references auth.users(id) on delete cascade,
    accepted_at timestamptz,
    check ((accepted_at is null) = (accepted_by is null))
);
create index staff_invitations_sender_idx on solar_private.staff_invitations (invited_by);
create index staff_invitations_recipient_idx on solar_private.staff_invitations (accepted_by);

alter table public.solar_profiles enable row level security;
alter table solar_private.staff_assignments enable row level security;
alter table solar_private.staff_invitations enable row level security;
revoke all on public.solar_profiles from public, anon, authenticated, service_role;
revoke all on all tables in schema solar_private from public, anon, authenticated, service_role;
grant select on public.solar_profiles to authenticated;

create function solar_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.solar_profiles (id, display_name)
    values (new.id, left(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), 120));
    return new;
end
$$;
create trigger solar_create_profile after insert on auth.users
for each row execute function solar_private.create_profile();
insert into public.solar_profiles (id, display_name)
select id, left(trim(coalesce(raw_user_meta_data->>'display_name', '')), 120) from auth.users;

-- Resolve the current account and session from the verified JWT on every call.
-- Role and email come from protected records. A revoked or banned identity has no actor row.
create function solar_private.actor() returns table (id uuid, email text, role text)
language sql stable security definer set search_path = '' as $$
    select u.id, u.email::text, coalesce(a.role, 'customer')
    from auth.users u
    join auth.sessions s on s.user_id = u.id and s.id = (auth.jwt()->>'session_id')::uuid
    left join solar_private.staff_assignments a on a.user_id = u.id
    where u.id = auth.uid() and u.email_confirmed_at is not null and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= now())
      and (s.not_after is null or s.not_after > now())
$$;

create policy read_solar_profiles on public.solar_profiles for select to authenticated
using (
    (select role from solar_private.actor()) = 'admin'
    or id = (select id from solar_private.actor())
);

create function public.solar_me() returns table (id uuid, email text, role text, display_name text)
language sql stable security invoker set search_path = '' as $$
    select a.id, a.email, a.role, p.display_name
    from solar_private.actor() a join public.solar_profiles p on p.id = a.id
$$;

-- A retry with the same digest returns the same invitation. A new digest rotates
-- an outstanding invitation. Acceptance and reissue serialize on its email row.
create function solar_private.invite_staff(target_email text, staff_role text, digest_hex text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
    admin_id uuid;
    deadline timestamptz;
begin
    select id into admin_id from solar_private.actor() where role = 'admin';
    if admin_id is null then
        raise sqlstate '42501' using message = 'admin_required';
    end if;
    target_email := lower(trim(target_email));
    if target_email is null or char_length(target_email) > 254
       or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or staff_role is null or staff_role not in ('technician','inventory','sales','admin')
       or digest_hex is null or digest_hex !~ '^[0-9a-f]{64}$' then
        raise sqlstate '22023' using message = 'invalid_invitation';
    end if;
    if exists (select 1 from auth.users u join solar_private.staff_assignments a on a.user_id = u.id
               where u.email = target_email) then
        raise sqlstate 'PT409' using message = 'already_staff';
    end if;
    insert into solar_private.staff_invitations as i (email, role, token_hash, invited_by, expires_at)
    values (target_email, staff_role, digest_hex, admin_id, now() + interval '24 hours')
    on conflict (email) do update set role = excluded.role, token_hash = excluded.token_hash,
        invited_by = excluded.invited_by, expires_at = case when i.token_hash = excluded.token_hash
            then i.expires_at else excluded.expires_at end
    where i.accepted_at is null and (i.token_hash <> excluded.token_hash
            or (i.role = excluded.role and i.invited_by = excluded.invited_by))
    returning expires_at into deadline;
    if deadline is null then
        raise sqlstate 'PT409' using message = 'invitation_conflict';
    end if;
    return deadline;
exception when unique_violation then
    raise sqlstate 'PT409' using message = 'invitation_conflict';
end
$$;

create function solar_private.accept_invitation(invite_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    recipient record;
    invitation solar_private.staff_invitations%rowtype;
begin
    select * into recipient from solar_private.actor();
    if not found or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then
        raise sqlstate '42501' using message = 'invitation_unavailable';
    end if;
    select * into invitation from solar_private.staff_invitations
    where email = lower(recipient.email)
      and token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex') for update;
    if not found then
        raise sqlstate '42501' using message = 'invitation_unavailable';
    end if;
    if invitation.accepted_by = recipient.id and exists (
        select 1 from solar_private.staff_assignments where user_id = recipient.id and role = invitation.role
    ) then
        return invitation.role;
    end if;
    if invitation.accepted_at is not null or invitation.expires_at <= clock_timestamp()
       or recipient.role <> 'customer'
       or not exists (select 1 from solar_private.staff_assignments a join auth.users u on u.id = a.user_id
                      where a.user_id = invitation.invited_by and a.role = 'admin'
                        and (u.banned_until is null or u.banned_until <= now())) then
        raise sqlstate '42501' using message = 'invitation_unavailable';
    end if;
    insert into solar_private.staff_assignments(user_id, role, assigned_by)
    values (recipient.id, invitation.role, invitation.invited_by);
    update solar_private.staff_invitations set accepted_by = recipient.id, accepted_at = now()
    where email = invitation.email;
    return invitation.role;
end
$$;

-- PostgREST exposes only these invoker wrappers in public. The private operations
-- recheck the caller so direct RPC and Edge requests have identical authorization.
create function public.solar_invite_staff(target_email text, staff_role text, digest_hex text)
returns timestamptz language sql security invoker set search_path = '' as $$
    select solar_private.invite_staff(target_email, staff_role, digest_hex)
$$;
create function public.solar_accept_invitation(invite_token text)
returns text language sql security invoker set search_path = '' as $$
    select solar_private.accept_invitation(invite_token)
$$;

revoke all on all functions in schema solar_private from public, anon, authenticated, service_role;
grant execute on function solar_private.actor(), solar_private.invite_staff(text,text,text),
    solar_private.accept_invitation(text) to authenticated;
revoke all on function public.solar_me(), public.solar_invite_staff(text,text,text),
    public.solar_accept_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.solar_me(), public.solar_invite_staff(text,text,text),
    public.solar_accept_invitation(text) to authenticated;
