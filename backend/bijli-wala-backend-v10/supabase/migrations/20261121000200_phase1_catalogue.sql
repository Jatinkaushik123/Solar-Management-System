-- Demo parts, prices, and warranty terms match the local catalogue.
WITH packages AS (
    SELECT capacity, grid,
           capacity || '-' || grid AS code,
           capacity || ' kW ' || initcap(grid) AS name,
           capacity * CASE WHEN grid = 'off-grid' THEN 7500000 ELSE 5000000 END AS total_paise
    FROM generate_series(1, 5) AS sizes(capacity)
    CROSS JOIN (VALUES ('on-grid'), ('off-grid')) AS kinds(grid)
), seeded AS (
    INSERT INTO solar_app.catalogue_packages (code, name, total_paise)
    SELECT code, name, total_paise FROM packages
    ON CONFLICT (code) DO NOTHING
    RETURNING code
)
INSERT INTO solar_app.catalogue_parts (package_code, position, name, quantity, unit, warranty_years)
SELECT packages.code, parts.position, parts.name, parts.quantity, parts.unit, parts.warranty_years
FROM packages
JOIN seeded USING (code)
CROSS JOIN LATERAL (
    VALUES
        (0, '500 W solar panel', 2 * packages.capacity, 'pcs', 20),
        (1, packages.capacity || ' kW ' || packages.grid || ' inverter', 1, 'pcs', 2),
        (2, 'Charge controller', 1, 'pcs', 2),
        (3, 'Mounting stand kit', 1, 'kit', NULL),
        (4, 'DC isolator switch', 1, 'pcs', NULL),
        (5, 'AC breaker', 1, 'pcs', NULL),
        (6, 'Wiring box', 1, 'pcs', NULL),
        (7, 'Solar cable', 10 * packages.capacity, 'm', NULL),
        (8, 'PV connector pair', 2, 'pairs', NULL),
        (9, 'Safety earthing kit', 1, 'kit', NULL),
        (10, 'Battery module', packages.capacity, 'pcs', 2)
) AS parts(position, name, quantity, unit, warranty_years)
WHERE parts.position <> 10 OR packages.grid = 'off-grid';
