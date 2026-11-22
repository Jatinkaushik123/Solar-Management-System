-- Hosted evaluation data. Run after seed.sql. Historical payments are seed records only.
-- The Gmail quote requires its confirmed Auth account to be provisioned separately.
do $demo$
declare
    admin_id uuid;
    tech_id uuid;
    sales_id uuid;
    warehouse_id uuid;
    owner_id uuid;
    email_address text;
    account record;
    job record;
    sku record;
    item record;
    enquiry uuid;
    site uuid;
    stock_check uuid;
    quote uuid;
    attempt uuid;
    receipt uuid;
    sales_order uuid;
    pick uuid;
    work uuid;
    shipment uuid;
    movement uuid;
    report uuid;
    time_entry uuid;
    ticket uuid;
    resolution uuid;
    project_date timestamptz;
    submitted_at timestamptz;
    dispatch_at timestamptz;
    is_complete boolean;
    quote_lines jsonb;
    stock_lines jsonb;
    install_cost bigint;
    goods_cost bigint;
    gst bigint;
    contract bigint;
    advance bigint;
    paid bigint;
    serial_label text;
    panel_no integer := 100;
    inverter_no integer := 0;
begin
    perform pg_advisory_xact_lock(hashtext('bijli-wala-evaluation-2026-v1'));
    if exists (select 1 from solar_private.enquiries where id=md5('bw-eval-2026-enquiry-13')::uuid) then
        return;
    end if;

    select id into strict admin_id from auth.users where email='admin@bijliwala.in';
    select id into strict tech_id from auth.users where email='tech@bijliwala.in';
    select id into strict sales_id from auth.users where email='sales@bijliwala.in';
    select id into strict warehouse_id from auth.users where email='inventory@bijliwala.in';
    perform 1 from auth.users where email='kaushikjatin2608@gmail.com' and email_confirmed_at is not null;
    if not found then raise exception 'The evaluation Gmail account must exist and be confirmed'; end if;
    insert into solar_private.technician_rates(technician_id,hourly_paise,set_by,updated_at)
    values(tech_id,85000,admin_id,'2026-06-01 08:00+05:30') on conflict do nothing;

    for account in select * from (values
        ('neha-malhotra','Neha Malhotra'), ('ananya-deshpande','Ananya Deshpande'),
        ('shah-printworks','Shah Printworks'), ('meenakshi-rao','Meenakshi Rao'),
        ('patel-textiles','Patel Textiles'),
        ('sneha-iyer','Sneha Iyer'), ('arvind-nair','Arvind Nair'),
        ('mehta-foods','Mehta Foods'), ('farah-khan','Farah Khan')
    ) as a(slug, display_name)
    loop
        owner_id := md5('bw-eval-2026-'||account.slug)::uuid;
        email_address := account.slug||'@demo.bijliwala.in';
        insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,
            raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
        values ('00000000-0000-0000-0000-000000000000',owner_id,'authenticated','authenticated',
            email_address,'2026-06-01 08:00+05:30','{"provider":"email","providers":["email"]}',
            jsonb_build_object('display_name',account.display_name),'2026-06-01 08:00+05:30',now(),'','','','');
    end loop;

    -- Dedicated SKUs leave the stock and serials used by test fixtures untouched.
    for sku in select * from (values
        ('BW-PNL-540','Waaree 540W Mono PERC rooftop module',134,1260000,870000,true,24,'BW-PNL-2026-',101,3),
        ('BW-INV-6K','Growatt 6 kW on-grid inverter',20,4700000,3400000,true,60,'BW-INV-2026-',1,2),
        ('BW-BOS-GI','GI elevated mounting & BOS kit',23,2440000,1730000,false,null,null,0,0),
        ('BW-BAT-LFP','LiFePO4 5.12 kWh wall battery',6,8300000,6800000,true,24,'BW-BAT-2026-',1,2)
    ) as s(code,name,opening,unit_price,unit_cost,serialized,warranty,prefix,start_no,padding)
    loop
        insert into solar_private.stock_items(item_id,name,on_hand,suggested_unit_paise,serialized,warranty_months)
        values (sku.code,sku.name,sku.opening,sku.unit_price,sku.serialized,sku.warranty);
        insert into solar_private.stock_movements(item_id,kind,delta,occurred_at)
        values (sku.code,'opening',sku.opening,'2026-06-01 08:00+05:30') returning id into receipt;
        if sku.serialized then
            insert into solar_private.stock_serials(serial,item_id,receipt_id)
            select sku.prefix||lpad(n::text,sku.padding,'0'),sku.code,receipt
            from generate_series(sku.start_no,sku.start_no+sku.opening-1) n;
        end if;
        insert into solar_private.material_rates(item_id,unit_cost_paise,set_by,updated_at)
        values(sku.code,sku.unit_cost,admin_id,'2026-06-01 08:00+05:30');
    end loop;

    for job in select * from (values
        (1,'neha-malhotra','Sector 45, Gurugram','5 kW On-Grid Rooftop','DHBVN · three phase',62,620000,10,1,'submitted','2026-11-21',true),
        (2,'ananya-deshpande','Kothrud, Pune','3 kW Hybrid Rooftop','MSEDCL · single phase',39,380000,6,1,'submitted','2026-11-21',true),
        (3,'shah-printworks','Naroda, Ahmedabad','10 kW Commercial Rooftop','Torrent Power · three phase',138,1540000,19,2,'assigned','2026-11-17',false),
        (4,'meenakshi-rao','Jayanagar, Bengaluru','5 kW On-Grid Rooftop','BESCOM · three phase',67,570000,10,1,'technical_approved','2026-11-19',true),
        (5,'kaushikjatin2608@gmail.com','Satellite, Ahmedabad','5 kW Residential Rooftop','Torrent Power · three phase',63,530000,10,1,'issued','2026-11-22',true),
        (6,'customer@bijliwala.in','Baner, Pune','3 kW Residential Rooftop','MSEDCL · single phase',42,350000,6,1,'issued','2026-11-22',true),
        (7,'patel-textiles','Sachin GIDC, Surat','15 kW Textile Workshop Rooftop','DGVCL · three phase',212,2830000,28,2,'scheduled','2026-11-21',false),
        (8,'customer@bijliwala.in','Aundh, Pune','5 kW Residential Rooftop','MSEDCL · three phase',68,640000,10,1,'scheduled','2026-11-21',true),
        (9,'sneha-iyer','Anna Nagar, Chennai','3 kW Residential Rooftop','TANGEDCO · single phase',43,420000,6,1,'completed','2026-06-19',true),
        (10,'arvind-nair','Kakkanad, Kochi','5 kW Residential Rooftop','KSEB · three phase',68,590000,10,1,'completed','2026-07-17',true),
        (11,'mehta-foods','Makarpura GIDC, Vadodara','8 kW Food Unit Rooftop','MGVCL · three phase',114,1780000,15,1,'completed','2026-08-24',false),
        (12,'farah-khan','Indira Nagar, Lucknow','5 kW Residential Rooftop','MVVNL · three phase',65,550000,10,1,'completed','2026-09-16',true),
        (13,'customer@bijliwala.in','Wakad, Pune','5 kW Residential Rooftop','MSEDCL · three phase',66,610000,10,1,'completed','2026-10-23',true)
    ) as j(number,owner_key,address,title,grid,roof,bill,panels,inverters,stage,day,residential)
    order by case when stage='completed' then 0 else 1 end, number
    loop
        email_address := case when position('@' in job.owner_key)>0 then job.owner_key else job.owner_key||'@demo.bijliwala.in' end;
        select u.id into strict owner_id from auth.users u where u.email=email_address;
        enquiry := md5('bw-eval-2026-enquiry-'||job.number)::uuid;
        project_date := (job.day::date + time '08:30') at time zone 'Asia/Kolkata';
        -- Issue today's quotes at execution time.
        if job.stage='issued' then project_date:=now(); end if;
        is_complete := job.stage='completed';
        submitted_at := project_date - case when job.stage='submitted' then interval '0' else interval '5 days' end;

        insert into solar_private.sites(owner_id,address) values(owner_id,job.address) returning id into site;
        insert into solar_private.enquiries(id,customer_id,site_id,contact_email,recipient_email,requirements,
            roof_space_m2,monthly_bill_paise,grid_details,technician_id,salesperson_id,revision,state,created_at)
        values(enquiry,owner_id,site,email_address,email_address,job.title||' — '||job.address,job.roof,job.bill,job.grid,
            case when job.stage<>'submitted' then tech_id end,case when job.stage<>'submitted' then sales_id end,
            case when job.stage in ('submitted','assigned') then 0 else 1 end,
            case when job.stage in ('completed','scheduled') then 'accepted' else job.stage end,submitted_at);
        insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id,at)
        values(enquiry,0,'submitted',owner_id,submitted_at);
        if job.stage='submitted' then continue; end if;

        insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id,at,detail)
        values(enquiry,0,'assigned',admin_id,submitted_at+interval '1 day',
            jsonb_build_object('technician_id',tech_id,'salesperson_id',sales_id));
        if job.stage='assigned' then continue; end if;

        insert into solar_private.designs(enquiry_id,revision,visited_at,roof_direction,tilt_deg,cable_m,approved_by,approved_at)
        values(enquiry,1,submitted_at+interval '2 days','South',case when job.residential then 15 else 12 end,23+job.panels,tech_id,submitted_at+interval '2 days 2 hours');
        insert into solar_private.equipment_lines(enquiry_id,revision,item_id,quantity)
        values(enquiry,1,'BW-PNL-540',job.panels),(enquiry,1,'BW-INV-6K',job.inverters),(enquiry,1,'BW-BOS-GI',job.inverters);
        insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id,at)
        values(enquiry,1,'technical_approved',tech_id,submitted_at+interval '2 days 2 hours');
        if job.stage='technical_approved' then continue; end if;

        select jsonb_agg(jsonb_build_object('item_id',l.item_id,'name',s.name,'quantity',l.quantity,
                'unit_paise',s.suggested_unit_paise) order by l.item_id),
            jsonb_agg(jsonb_build_object('item_id',l.item_id,'name',s.name,'required',l.quantity,'quantity',l.quantity,
                'available',s.on_hand,'enough',true,'shortage',0) order by l.item_id),
            sum(l.quantity*s.suggested_unit_paise)
        into quote_lines,stock_lines,goods_cost
        from solar_private.equipment_lines l join solar_private.stock_items s using(item_id)
        where l.enquiry_id=enquiry;
        install_cost := 1800000+job.panels*82000;
        -- Evaluation estimate. An illustrative GST allocation is included in the installation subtotal.
        gst := round((goods_cost+install_cost)*0.089);
        contract := goods_cost+install_cost+gst;
        advance := round(contract*0.20);
        quote_lines := jsonb_set(quote_lines,'{0,estimate}',jsonb_build_object(
            'installation_paise',install_cost,'gst_paise',gst,
            'subsidy_paise',case when job.residential then 7800000 else 0 end));
        insert into solar_private.stock_checks(enquiry_id,revision,actor_id,checked_at,outcome,lines)
        values(enquiry,1,warehouse_id,submitted_at+interval '3 days','approved',stock_lines) returning id into stock_check;
        quote := md5('bw-eval-2026-quote-'||job.number)::uuid;
        insert into solar_private.quotes(id,enquiry_id,design_revision,stock_check_id,revision,state,lines,price_version,
            installation_paise,valid_until,advance_kind,advance_value,total_paise,advance_paise,recipient_email,
            issued_at,issued_by,decided_at,decided_by)
        values(quote,enquiry,1,stock_check,1,case when job.stage='issued' then 'issued' else 'accepted' end,
            quote_lines,1,install_cost+gst,(project_date at time zone 'Asia/Kolkata')::date+30,
            'percentage',2000,contract,advance,email_address,
            case when job.stage='issued' then project_date else project_date-interval '1 day' end,sales_id,
            case when job.stage<>'issued' then project_date-interval '8 hours' end,
            case when job.stage<>'issued' then owner_id end);
        insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id,at,detail)
        values(enquiry,1,'stock_approved',warehouse_id,submitted_at+interval '3 days',jsonb_build_object('stock_check_id',stock_check)),
            (enquiry,1,'quote_issued',sales_id,case when job.stage='issued' then project_date else project_date-interval '1 day' end,
             jsonb_build_object('quote_id',quote,'quote_revision',1));
        if job.stage='issued' then continue; end if;
        insert into solar_private.workflow_events(enquiry_id,revision,action,actor_id,at,detail)
        values(enquiry,1,'quote_accepted',owner_id,project_date-interval '8 hours',jsonb_build_object('quote_id',quote));

        paid := case when is_complete then contract else advance end;
        insert into solar_private.checkout_attempts(quote_id,choice,amount_paise,state,created_at,expires_at)
        values(quote,case when is_complete then 'full' else 'advance' end,paid,'captured',
            project_date-interval '7 hours',project_date-interval '6 hours 45 minutes') returning id into attempt;
        insert into solar_private.payment_receipts(provider_payment_id,attempt_id,amount_paise,currency,credited_at)
        values('seed_bw_eval_2026_'||job.number,attempt,paid,'INR',project_date-interval '7 hours') returning id into receipt;
        insert into solar_private.sales_orders(quote_id,confirmed_at,confirmation_receipt_id)
        values(quote,project_date-interval '7 hours',receipt) returning id into sales_order;
        insert into solar_private.pick_lists(order_id,state) values(sales_order,'dispatched') returning id into pick;
        insert into solar_private.installation_work_orders(order_id,state,technician_id,scheduled_at,scheduled_by)
        values(sales_order,job.stage,tech_id,case when is_complete then project_date else project_date+interval '5 days' end,admin_id)
        returning id into work;
        insert into solar_private.installation_schedule_events(work_id,technician_id,scheduled_by,scheduled_at,recorded_at)
        select id,technician_id,scheduled_by,scheduled_at,project_date-interval '5 hours'
        from solar_private.installation_work_orders where id=work;
        dispatch_at := project_date-interval '4 hours';
        insert into solar_private.shipments(pick_list_id,dispatched_by,dispatched_at,delivered_by,delivered_at)
        values(pick,warehouse_id,dispatch_at,warehouse_id,project_date-interval '1 hour') returning id into shipment;
        for item in select l.item_id,l.quantity,s.serialized,s.warranty_months
            from solar_private.equipment_lines l join solar_private.stock_items s using(item_id)
            where l.enquiry_id=enquiry order by l.item_id
        loop
            insert into solar_private.order_reservations(order_id,item_id,quantity,consumed_at)
            values(sales_order,item.item_id,item.quantity,dispatch_at);
            update solar_private.stock_items set on_hand=on_hand-item.quantity where item_id=item.item_id;
            insert into solar_private.stock_movements(item_id,kind,delta,shipment_id,actor_id,occurred_at)
            values(item.item_id,'dispatch',-item.quantity,shipment,warehouse_id,dispatch_at) returning id into movement;
            -- The normal dispatch trigger captures the rate. Date it to the seeded dispatch.
            update solar_private.movement_costs set recorded_at=dispatch_at where movement_id=movement;
            if not item.serialized then continue; end if;
            for n in 1..item.quantity loop
                if item.item_id='BW-PNL-540' then
                    panel_no:=panel_no+1;
                    serial_label:='BW-PNL-2026-'||panel_no;
                else
                    inverter_no:=inverter_no+1;
                    serial_label:='BW-INV-2026-'||lpad(inverter_no::text,2,'0');
                end if;
                insert into solar_private.shipment_serials(serial,item_id,movement_id)
                values(serial_label,item.item_id,movement);
                insert into solar_private.warranties(serial,term_months,starts_on,expires_on)
                values(serial_label,item.warranty_months,job.day::date,
                    (job.day::date+make_interval(months=>item.warranty_months))::date);
            end loop;
        end loop;
        if not is_complete then continue; end if;

        insert into solar_private.installation_reports(work_id,technician_id,started_at,ended_at,system_kw,generation_test,recorded_at)
        values(work,tech_id,project_date,project_date+interval '5 hours',job.panels*0.540,'pass',project_date+interval '5 hours')
        returning id into report;
        insert into solar_private.installation_signoffs(work_id,report_id,customer_id,signed_at)
        values(work,report,owner_id,project_date+interval '6 hours');
        insert into solar_private.technician_time(technician_id,installation_report_id,worked_on,minutes,hourly_paise,recorded_at)
        values(tech_id,report,job.day::date,300,85000,project_date+interval '6 hours') returning id into time_entry;
        insert into solar_private.technician_payments(time_id,amount_paise,reference,paid_on,recorded_by,recorded_at)
        values(time_entry,425000,'PAY-BW-EVAL-'||job.number,job.day::date,admin_id,project_date+interval '7 hours');
        if job.residential then
            insert into solar_private.subsidy_events(order_id,status,amount_paise,reference,actor_id,recorded_at)
            values(sales_order,'applied',0,'PMSG-DEMO-'||job.number,admin_id,project_date+interval '6 hours'),
                (sales_order,'approved',7800000,'PMSG-DEMO-'||job.number,admin_id,project_date+interval '7 days'),
                (sales_order,'received',7800000,'PMSG-DEMO-'||job.number,admin_id,project_date+interval '14 days');
        end if;

        if job.number not in (12,13) then continue; end if;
        select x.serial into strict serial_label from solar_private.shipment_serials x
        join solar_private.stock_movements m on m.id=x.movement_id
        where m.shipment_id=shipment and x.item_id='BW-INV-6K';
        insert into solar_private.service_tickets(order_id,serial,warranty_id,warranty_starts_on,warranty_expires_on,
            coverage,fault,opened_by,opened_at,state,technician_id,closed_by,closed_at)
        select sales_order,serial_label,w.id,w.starts_on,w.expires_on,'covered',
            case when job.number=13 then 'Growatt inverter shows intermittent grid AC voltage high alert around 13:00. Generation resumes after five minutes.'
                 else 'Post-monsoon preventive inspection requested after a minor drop in string output.' end,
            owner_id,'2026-11-17 10:00+05:30',case when job.number=13 then 'assigned' else 'closed' end,tech_id,
            case when job.number=12 then owner_id end,case when job.number=12 then '2026-11-19 15:00+05:30'::timestamptz end
        from solar_private.warranties w where w.serial=serial_label returning id into ticket;
        insert into solar_private.service_events(ticket_id,actor_id,action,occurred_at,detail)
        values(ticket,owner_id,'opened','2026-11-17 10:00+05:30','{}'),
            (ticket,admin_id,'assigned','2026-11-17 11:00+05:30',jsonb_build_object('technician_id',tech_id));
        if job.number=13 then continue; end if;
        insert into solar_private.service_resolutions(ticket_id,technician_id,diagnosis,work_performed,labour_charge_paise,submission,finalized_at)
        values(ticket,tech_id,'Dust at the lower module edges reduced output; inverter and isolators passed.',
            'Cleaned the modules, tightened terminations and recorded a passing generation check.',0,'{}','2026-11-19 12:00+05:30')
        returning id into resolution;
        insert into solar_private.technician_time(technician_id,service_resolution_id,worked_on,minutes,hourly_paise,recorded_at)
        values(tech_id,resolution,'2026-11-19',60,85000,'2026-11-19 12:00+05:30');
        insert into solar_private.service_events(ticket_id,actor_id,action,occurred_at,detail)
        values(ticket,tech_id,'resolved','2026-11-19 12:00+05:30',jsonb_build_object('resolution_id',resolution)),
            (ticket,owner_id,'confirmed','2026-11-19 15:00+05:30','{}');
    end loop;
end
$demo$;
