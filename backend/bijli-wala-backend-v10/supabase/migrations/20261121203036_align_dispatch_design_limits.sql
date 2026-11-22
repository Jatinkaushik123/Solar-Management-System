-- Keep the dispatch manifest within the existing equipment design limits.
create or replace function solar_private.dispatch_stock(actor uuid,target uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p solar_private.pick_lists; h solar_private.shipments; line jsonb; manifest jsonb:='[]';
    item text; qty integer; s solar_private.stock_items; serials text[]; m uuid; seen integer;
begin
    perform solar_private.fields(body,array['lines']);
    if (case when jsonb_typeof(body->'lines')='array' then jsonb_array_length(body->'lines') not between 1 and 100 else true end) then
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
        qty:=solar_private.amount(line,'quantity',1,10000);
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
