-- Trusted operator and rollback only. Set solar.qa_mail_quote to the freshly
-- issued fixture quote in the same SQL request. This test makes no network calls.
do $test$
declare sample solar_private.quote_emails; token text; job jsonb; retry_job jsonb;
    request_payload jsonb; frozen jsonb; proof_id uuid:=gen_random_uuid();
begin
    select m.* into strict sample from solar_private.quote_emails m
    join solar_private.quotes q on q.id=m.quote_id join solar_private.enquiries e on e.id=q.enquiry_id
    join solar_private.sites s on s.id=e.site_id
    where m.quote_id=current_setting('solar.qa_mail_quote')::uuid and q.state='issued'
        and s.address like 'Release synthetic mail %' and m.recipient like '%@identity.sunpower.test'
        and m.next_attempt_at is not null and m.attempt_count=0;
    select s.decrypted_secret into strict token from solar_private.worker_credentials w
        join vault.decrypted_secrets s on s.id=w.vault_id where w.name='quote_email';
    if (select count(*) from solar_private.quote_emails where quote_id=sample.quote_id)<>1 then
        raise exception 'Quote issuance duplicated its outbox row';
    end if;
    begin
        if solar_private.claim_quote_emails(token,false,null)<>'[]' then raise exception 'Unconfigured worker claimed email'; end if;
        update solar_private.quote_emails set next_attempt_at=now()-interval '1 day' where id=sample.id;
        if exists(select 1 from jsonb_array_elements(solar_private.claim_quote_emails(token,true,null)) x where x->>'id'=sample.id::text) then
            raise exception 'Default delivery included a reserved test address';
        end if;
        select x into strict job from jsonb_array_elements(solar_private.claim_quote_emails(token,true,sample.recipient)) x
        where x->>'id'=sample.id::text;
        if exists(select 1 from jsonb_array_elements(solar_private.claim_quote_emails(token,true,sample.recipient)) x where x->>'id'=sample.id::text) then
            raise exception 'Active lease was reissued';
        end if;
        request_payload:=jsonb_build_object('to',sample.recipient,'from','no-reply@fixture.invalid','text','Rollback-only test');
        frozen:=solar_private.prepare_quote_email(token,sample.id,(job->>'lease_id')::uuid,request_payload);
        if frozen is distinct from request_payload then raise exception 'Worker did not freeze the request'; end if;
        if not solar_private.finish_quote_email(token,sample.id,(job->>'lease_id')::uuid,'retry',null,'network_error') then
            raise exception 'Worker did not record its retry';
        end if;
        if not exists(select 1 from solar_private.quote_emails e where e.id=sample.id and e.status='pending'
            and e.next_attempt_at>now() and e.attempt_count=1 and e.last_error='network_error') then
            raise exception 'Retry did not preserve and reschedule the same message';
        end if;
        update solar_private.quote_emails set next_attempt_at=now()-interval '1 day' where id=sample.id;
        select x into strict retry_job from jsonb_array_elements(solar_private.claim_quote_emails(token,true,sample.recipient)) x
        where x->>'id'=sample.id::text;
        if retry_job->>'lease_id'=job->>'lease_id' then raise exception 'Retry did not receive a fresh lease'; end if;
        if solar_private.finish_quote_email(token,sample.id,(job->>'lease_id')::uuid,'accepted',proof_id,null) then
            raise exception 'An expired lease finalized the retry';
        end if;
        if solar_private.prepare_quote_email(token,sample.id,(retry_job->>'lease_id')::uuid,
            request_payload||'{"text":"changed"}'::jsonb) is distinct from request_payload then
            raise exception 'Worker changed the provider body during retry';
        end if;
        if not solar_private.finish_quote_email(token,sample.id,(retry_job->>'lease_id')::uuid,'accepted',proof_id,null) then
            raise exception 'Worker did not finalize its leased message';
        end if;
        if not exists(select 1 from solar_private.quote_emails e where e.id=sample.id and e.status='sent'
            and e.provider_message_id=proof_id and e.attempt_count=2) then
            raise exception 'Provider acceptance was not recorded once';
        end if;
        update solar_private.quote_emails set status='pending',provider_message_id=null,sent_at=null,
            first_attempt_at=now()-interval '24 hours',next_attempt_at=now()-interval '1 day' where id=sample.id;
        if exists(select 1 from jsonb_array_elements(solar_private.claim_quote_emails(token,true,sample.recipient)) x where x->>'id'=sample.id::text) then
            raise exception 'Expired provider deduplication window was retried';
        end if;
        if not exists(select 1 from solar_private.quote_emails e where e.id=sample.id and e.attention_at is not null) then
            raise exception 'Expired provider deduplication window needs review';
        end if;
        raise exception using errcode='ZX004',message='rollback email rehearsal';
    exception when sqlstate 'ZX004' then null;
    end;
    if not exists(select 1 from solar_private.quote_emails e where e.id=sample.id and e.status='pending'
        and e.attempt_count=0 and e.provider_message_id is null) then raise exception 'Rehearsal leaked changes'; end if;
end $test$;
