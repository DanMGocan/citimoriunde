BEGIN;
CREATE FUNCTION city_key(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT trim(regexp_replace(lower(public.unaccent($1)), '[^[:alnum:]]+', ' ', 'g')) $$;
CREATE UNIQUE INDEX libraries_normalized_canonical ON libraries(country_code,city_key(name),coalesce(city_key(region),''));
CREATE UNIQUE INDEX pending_library_request_normalized ON library_requests(country_code,locality_key,city_key(region)) WHERE state='PENDING';
COMMIT;
