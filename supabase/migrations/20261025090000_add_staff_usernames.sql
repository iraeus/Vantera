ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9._-]{3,32}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;
