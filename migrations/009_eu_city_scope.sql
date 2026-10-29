BEGIN;
-- EU membership verified on 2026-10-09 against the official EU country directory.
-- Keep historical libraries, members, copies and loans; only eligibility changes.
UPDATE libraries SET active=false,rank=NULL
WHERE NOT (country_code::text=ANY(ARRAY['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']::text[]));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='libraries'::regclass AND conname='libraries_active_eu_country') THEN
    ALTER TABLE libraries ADD CONSTRAINT libraries_active_eu_country
      CHECK (NOT active OR country_code::text=ANY(ARRAY['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']::text[]));
  END IF;
END $$;

-- Refresh the initial-source ranking without replacing administrator labels or IDs.
-- Values are generated from the checked-in 35-city manifest and UN snapshot.
CREATE TEMP TABLE eu_initial_ranks(source_id text PRIMARY KEY,rank int NOT NULL) ON COMMIT DROP;
INSERT INTO eu_initial_ranks(source_id,rank) VALUES
    ('un-wup2025-city:2994',1),
    ('un-wup2025-city:3440',2),
    ('un-wup2025-city:5068',3),
    ('un-wup2025-city:5576',4),
    ('un-wup2025-city:833',5),
    ('un-wup2025-city:4726',6),
    ('un-wup2025-city:675',7),
    ('un-wup2025-city:1848',8),
    ('un-wup2025-city:4156',9),
    ('un-wup2025-city:1054',10),
    ('un-wup2025-city:217',11),
    ('un-wup2025-city:2329',12),
    ('un-wup2025-city:3660',13),
    ('un-wup2025-city:5337',14),
    ('un-wup2025-city:4278',15),
    ('un-wup2025-city:942',16),
    ('un-wup2025-city:1672',17),
    ('un-wup2025-city:1157',18),
    ('un-wup2025-city:4574',19),
    ('un-wup2025-city:1754',20),
    ('un-wup2025-city:680',21),
    ('un-wup2025-city:4068',22),
    ('un-wup2025-city:542',23),
    ('un-wup2025-city:61',24),
    ('un-wup2025-city:377',25),
    ('un-wup2025-city:1160',26),
    ('un-wup2025-city:100',27),
    ('un-wup2025-city:387',28),
    ('un-wup2025-city:555',29),
    ('un-wup2025-city:1030',30),
    ('un-wup2025-city:807',31),
    ('un-wup2025-city:3500',32),
    ('un-wup2025-city:262',33),
    ('un-wup2025-city:948',34),
    ('un-wup2025-city:2553',35);
UPDATE libraries SET rank=NULL WHERE source_id IN (SELECT source_id FROM eu_initial_ranks);

-- Add the three requested Romanian cities using verified F21 source cells.
-- Reuse an existing canonical/alias match so member and loan references remain intact.
DO $$
DECLARE
  city record;
  library_id uuid;
  existing_source text;
BEGIN
  FOR city IN SELECT * FROM (VALUES
    ('un-wup2025-city:262','Timișoara','Timișoara',ARRAY['Timisoara','Timişoara']::text[],'RO',45.7502570445514,21.2272190237239,319240,2025,'Population of harmonised DEGURBA cities at mid-year (1 July), converted from thousands to persons; not administrative city-proper or metropolitan population.','https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx',33),
    ('un-wup2025-city:948','Cluj-Napoca','Cluj-Napoca',ARRAY['Cluj','Cluj Napoca']::text[],'RO',46.7721064518631,23.59250582513,310650,2025,'Population of harmonised DEGURBA cities at mid-year (1 July), converted from thousands to persons; not administrative city-proper or metropolitan population.','https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx',34),
    ('un-wup2025-city:2553','Iași','Iași',ARRAY['Iasi','Iaşi']::text[],'RO',47.1567165562658,27.5846513489162,275840,2025,'Population of harmonised DEGURBA cities at mid-year (1 July), converted from thousands to persons; not administrative city-proper or metropolitan population.','https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx',35)
  ) AS cities(source_id,name,display_name,aliases,country_code,latitude,longitude,population,population_year,population_definition,source_url,rank) LOOP
    SELECT l.id,l.source_id INTO library_id,existing_source FROM libraries l
    WHERE l.source_id=city.source_id OR (
      l.country_code=city.country_code AND (
        city_key(l.name)=ANY(ARRAY(SELECT city_key(value) FROM unnest(ARRAY[city.name,city.display_name]||city.aliases) value)) OR
        city_key(l.display_name)=ANY(ARRAY(SELECT city_key(value) FROM unnest(ARRAY[city.name,city.display_name]||city.aliases) value)) OR
        EXISTS(SELECT 1 FROM unnest(l.aliases) alias WHERE city_key(alias)=ANY(ARRAY(SELECT city_key(value) FROM unnest(ARRAY[city.name,city.display_name]||city.aliases) value)))
      )
    )
    ORDER BY (l.source_id=city.source_id) DESC NULLS LAST,l.created_at,l.id LIMIT 1;
    IF library_id IS NULL THEN
      INSERT INTO libraries(source_id,name,display_name,aliases,country_code,latitude,longitude,population,population_year,population_definition,source_url)
      VALUES(city.source_id,city.name,city.display_name,
        ARRAY(SELECT DISTINCT alias FROM unnest(city.aliases||ARRAY[city.name,city.display_name]) alias ORDER BY alias),
        city.country_code,city.latitude,city.longitude,city.population,city.population_year,city.population_definition,city.source_url);
    ELSE
      IF existing_source IS NOT NULL AND existing_source<>city.source_id THEN
        RAISE EXCEPTION 'Requested Romanian city matches a different source identifier; review canonical geography before migrating';
      END IF;
      UPDATE libraries SET source_id=city.source_id,
        aliases=ARRAY(SELECT DISTINCT alias FROM unnest(libraries.aliases||city.aliases||ARRAY[city.name,city.display_name]) alias ORDER BY alias),
        latitude=city.latitude,longitude=city.longitude,population=city.population,population_year=city.population_year,
        population_definition=city.population_definition,source_url=city.source_url
      WHERE id=library_id;
    END IF;
  END LOOP;
END $$;
UPDATE libraries l SET rank=r.rank FROM eu_initial_ranks r WHERE l.source_id=r.source_id;
COMMIT;
