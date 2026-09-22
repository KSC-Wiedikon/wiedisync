-- 370 — A training slot can occupy more than one hall.
--
-- `hall_slots.hall` is a single FK, so a team that trains in KWI B from 18:00
-- and takes KWI A as well from 18:30 had to be modelled as TWO slots. Each slot
-- generates its own trainings, so every Tuesday Herren 1 (BB) got two trainings
-- and two RSVPs for what is one session (reported 22.09.2026). DU12 has the
-- same shape on Monday (Borrweg 1 + Borrweg 2).
--
-- `extra_halls` (json) lists the additional halls a slot also occupies:
--
--     [{ "hall": 1, "start_time": "18:30", "end_time": null }]
--
-- `start_time` / `end_time` are optional and narrow the window inside the
-- slot's own range (null = the slot's own time). This is deliberately NOT the
-- flat id array of `games.additional_halls`: HU18 holds KWI A until 18:30, so
-- the extra hall genuinely has a different window than the primary one. The
-- different name keeps `allGameHallIds()` / `hallIdsOf()` from ever being fed
-- the object shape by mistake.
--
-- `hall` stays the primary hall and every existing reader keeps working
-- unchanged. `trainings.extra_halls` is a per-occurrence copy written by the
-- slot cascade (slot-cascade.js), same as `hall`.
--
-- Schema only. Merging the existing split slot pairs is a separate, reviewed
-- data step (it deletes duplicate future trainings).

BEGIN;

ALTER TABLE public.hall_slots ADD COLUMN IF NOT EXISTS extra_halls json;
ALTER TABLE public.trainings  ADD COLUMN IF NOT EXISTS extra_halls json;

INSERT INTO directus_fields (collection, field, special, interface, options, note, width)
SELECT v.c, 'extra_halls', 'cast-json', 'input-code', '{"language":"json"}',
       'Additional halls this slot also occupies: [{"hall": <id>, "start_time": "HH:MM"|null, "end_time": "HH:MM"|null}]. Null/empty = single hall. See migration 370.',
       'full'
  FROM (VALUES ('hall_slots'), ('trainings')) v(c)
 WHERE NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection = v.c AND f.field = 'extra_halls');

-- Normalises to a clean array (or NULL) and rejects anything a reader could
-- misplace on the Hallenplan: unknown hall, the primary hall again, duplicates,
-- or a window outside the slot's own range. A bare id is accepted and wrapped.
CREATE OR REPLACE FUNCTION public.hall_slots_validate_extra_halls()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e       jsonb;
  h       int;
  s       time;
  f       time;
  seen    int[] := '{}';
  cleaned jsonb := '[]'::jsonb;
BEGIN
  IF NEW.extra_halls IS NULL OR jsonb_typeof(NEW.extra_halls::jsonb) = 'null' THEN
    NEW.extra_halls := NULL;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.extra_halls::jsonb) <> 'array' THEN
    RAISE EXCEPTION 'extra_halls must be an array' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(NEW.extra_halls::jsonb) LOOP
    IF jsonb_typeof(e) IN ('number', 'string') THEN
      e := jsonb_build_object('hall', e);
    END IF;
    IF jsonb_typeof(e) <> 'object' OR NOT (e ? 'hall') THEN
      RAISE EXCEPTION 'extra_halls entries need a "hall"' USING ERRCODE = 'check_violation';
    END IF;
    h := (e->>'hall')::int;
    IF NOT EXISTS (SELECT 1 FROM halls WHERE id = h) THEN
      RAISE EXCEPTION 'extra_halls: hall % does not exist', h USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF h = NEW.hall THEN
      RAISE EXCEPTION 'extra_halls: hall % is already the primary hall', h USING ERRCODE = 'check_violation';
    END IF;
    IF h = ANY (seen) THEN
      RAISE EXCEPTION 'extra_halls: hall % listed twice', h USING ERRCODE = 'check_violation';
    END IF;
    seen := seen || h;
    s := NULLIF(e->>'start_time', '')::time;
    f := NULLIF(e->>'end_time', '')::time;
    IF (s IS NOT NULL AND NEW.start_time IS NOT NULL AND s < NEW.start_time)
       OR (f IS NOT NULL AND NEW.end_time IS NOT NULL AND f > NEW.end_time)
       OR (COALESCE(s, NEW.start_time) >= COALESCE(f, NEW.end_time)) THEN
      RAISE EXCEPTION 'extra_halls: window for hall % must lie inside the slot time', h USING ERRCODE = 'check_violation';
    END IF;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object(
      'hall', h,
      'start_time', CASE WHEN s IS NULL OR s = NEW.start_time THEN NULL ELSE to_char(s, 'HH24:MI') END,
      'end_time',   CASE WHEN f IS NULL OR f = NEW.end_time   THEN NULL ELSE to_char(f, 'HH24:MI') END));
  END LOOP;
  NEW.extra_halls := CASE WHEN jsonb_array_length(cleaned) = 0 THEN NULL ELSE cleaned::json END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hall_slots_validate_extra_halls ON public.hall_slots;
CREATE TRIGGER trg_hall_slots_validate_extra_halls
  BEFORE INSERT OR UPDATE OF extra_halls, hall, start_time, end_time ON public.hall_slots
  FOR EACH ROW EXECUTE FUNCTION public.hall_slots_validate_extra_halls();

COMMIT;
