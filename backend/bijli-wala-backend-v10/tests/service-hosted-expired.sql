-- Trusted operator setup. Set solar.qa_expired_quote to the M5 companion quote
-- in the same SQL request. The quote must be delivered and lack sign-off.
do $fixture$
declare f record; start_day date:=(current_date - interval '62 months')::date;
    delivered timestamptz; confirmed timestamptz; unit_count integer;
begin
    select p.id,p.quote_id,p.shipment_id,p.work_id into strict f
    from solar_private.fulfilment_projects p join solar_private.enquiries e on e.id=p.enquiry_id
    join auth.users u on u.id=p.customer_id
    where p.quote_id=current_setting('solar.qa_expired_quote')::uuid
        and p.address like 'M5 synthetic service %' and e.requirements='QA accepted rooftop'
        and u.email like '%@identity.sunpower.test' and p.work_state='ready_to_schedule'
        and p.delivered_at is not null
        and exists(select 1 from solar_private.payment_receipts r join solar_private.checkout_attempts a on a.id=r.attempt_id
            where a.quote_id=p.quote_id and r.provider_payment_id like 'pay_FULFILQA%');
    delivered:=(start_day::timestamp at time zone 'Asia/Kolkata')+interval '12 hours';
    confirmed:=delivered-interval '2 days';
    update solar_private.sales_orders set confirmed_at=confirmed where id=f.id;
    update solar_private.checkout_attempts set created_at=confirmed-interval '1 minute',
        expires_at=confirmed+interval '14 minutes' where quote_id=f.quote_id;
    update solar_private.payment_receipts r set credited_at=confirmed from solar_private.checkout_attempts a
        where a.id=r.attempt_id and a.quote_id=f.quote_id;
    update solar_private.shipments set dispatched_at=delivered-interval '1 day',delivered_at=delivered where id=f.shipment_id;
    update solar_private.warranties w set starts_on=start_day,expires_on=(start_day+make_interval(months=>w.term_months))::date
        from solar_private.shipment_serials x join solar_private.stock_movements m on m.id=x.movement_id
        where x.serial=w.serial and m.shipment_id=f.shipment_id;
    get diagnostics unit_count=row_count;
    if unit_count<>1 then raise exception 'Expected one synthetic expired warranty'; end if;
end $fixture$;
