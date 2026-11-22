CREATE TABLE solar_app.shipments (
    pick_list_id bigint PRIMARY KEY REFERENCES solar_app.pick_lists(id),
    dispatched_on date NOT NULL,
    delivered_on date CHECK (delivered_on >= dispatched_on)
);

CREATE TABLE solar_app.serialized_units (
    serial_key text COLLATE "C" PRIMARY KEY,
    serial text NOT NULL CHECK (char_length(serial) BETWEEN 1 AND 80),
    pick_list_id bigint NOT NULL REFERENCES solar_app.shipments(pick_list_id),
    product text NOT NULL,
    unit_number integer NOT NULL CHECK (unit_number > 0),
    warranty_years integer NOT NULL CHECK (warranty_years > 0),
    UNIQUE (pick_list_id, product, unit_number)
);

CREATE TABLE solar_app.crew_assignments (
    crew_job_id bigint PRIMARY KEY REFERENCES solar_app.crew_jobs(id),
    crew text NOT NULL CHECK (char_length(crew) BETWEEN 1 AND 100),
    scheduled_on date NOT NULL
);

CREATE TABLE solar_app.commissioning (
    crew_job_id bigint PRIMARY KEY REFERENCES solar_app.crew_jobs(id),
    started_at timestamp without time zone NOT NULL,
    ended_at timestamp without time zone NOT NULL CHECK (ended_at > started_at),
    capacity_watts integer NOT NULL CHECK (capacity_watts > 0),
    generation_test text NOT NULL CHECK (generation_test = 'pass'),
    photo bytea NOT NULL CHECK (octet_length(photo) > 0),
    signature bytea NOT NULL CHECK (octet_length(signature) > 0),
    completed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
