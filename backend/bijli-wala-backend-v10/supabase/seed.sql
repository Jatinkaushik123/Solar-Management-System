-- Demo project only. Existing identities keep their passwords and roles.
do $$
declare
    account record;
    account_id uuid;
begin
    for account in
        select * from (values
            ('admin@bijliwala.in',     'Arjun Mehta',   'admin'),
            ('sales@bijliwala.in',     'Rajesh Sharma', 'sales'),
            ('tech@bijliwala.in',      'Kavita Iyer',   'technician'),
            ('inventory@bijliwala.in', 'Imran Khan',    'inventory'),
            ('customer@bijliwala.in',  'Amit Kumar',    null)
        ) as demo(email, display_name, staff_role)
    loop
        if exists (select 1 from auth.users where lower(email) = account.email) then
            continue;
        end if;

        account_id := gen_random_uuid();
        insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new, email_change
        ) values (
            '00000000-0000-0000-0000-000000000000', account_id, 'authenticated', 'authenticated',
            account.email, extensions.crypt('Bijli@123', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', account.display_name), now(), now(), '', '', '', ''
        );

        insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
        values (account_id::text, account_id,
                jsonb_build_object('sub', account_id::text, 'email', account.email, 'email_verified', true),
                'email', now(), now());

        if account.staff_role is not null then
            insert into solar_private.staff_assignments (user_id, role)
            values (account_id, account.staff_role);
        end if;
    end loop;
end
$$;
