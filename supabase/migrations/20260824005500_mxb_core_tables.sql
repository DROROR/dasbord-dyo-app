
CREATE TABLE IF NOT EXISTS mxb_power_list_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  full_name text NOT NULL,
  category text,
  job_title text,
  organization text,
  country text,
  territory text,
  short_bio text,
  full_bio text,
  selection_reason text,
  photo text,
  photo_credit text,
  photo_license text,
  photo_source text,
  edition_category text,
  power_list_name text,
  year integer DEFAULT 2027,
  expertise text[],
  is_public boolean DEFAULT true,
  featured_home boolean DEFAULT false,
  featured boolean DEFAULT false,
  claimable_profile boolean DEFAULT false,
  registered_user boolean DEFAULT false,
  entity_type text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_selection_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  contact_name text,
  surname text,
  phone text,
  brand text,
  website text,
  photo text,
  display_name text,
  categories text[],
  title text,
  bio_short text,
  bio_long text,
  editions jsonb DEFAULT '{"cannes": false, "berlinale": false}',
  trailer_submitted boolean DEFAULT false,
  trailer_link text,
  synopsis text,
  video_uploaded boolean DEFAULT false,
  video_approved_for_public boolean DEFAULT false,
  approved boolean DEFAULT false,
  profile_status text DEFAULT 'pending_basic_info',
  registered_date date DEFAULT CURRENT_DATE,
  requires_payment boolean DEFAULT true,
  amount numeric DEFAULT 397,
  paid boolean DEFAULT false,
  power_list_status text,
  credits integer DEFAULT 0,
  master_file_received boolean DEFAULT false,
  messages jsonb DEFAULT '[]',
  member_slug text UNIQUE,
  can_publish_insights boolean DEFAULT false,
  public_profile boolean DEFAULT false,
  public_insights boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  is_mxb_contributor boolean DEFAULT false,
  referred_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  category text CHECK (category IN ('festival','comision','pr','talent_agency','influencer_agency')),
  org_name text NOT NULL,
  contact_name text,
  phone text,
  website text,
  tagline text,
  description text,
  category_data jsonb DEFAULT '{}',
  access_status text DEFAULT 'pending' CHECK (access_status IN ('pending','approved')),
  profile_status text DEFAULT 'not_started' CHECK (profile_status IN ('not_started','approved')),
  registered_date date DEFAULT CURRENT_DATE,
  requires_payment boolean DEFAULT false,
  amount numeric DEFAULT 0,
  messages jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_institution_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by text,
  submitted_by_email text,
  submitted_by_category text,
  visible_in text[],
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_community_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_email text,
  author_name text,
  author_slug text,
  author_photo text,
  author_category text,
  title text NOT NULL,
  slug text UNIQUE,
  quote text,
  body text,
  image text,
  category text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  featured boolean DEFAULT false,
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_power_list_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nominee_name text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','reviewed')),
  submitted_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_brand_partner_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type text DEFAULT 'global_brand_partner',
  source text DEFAULT 'public_home_brand_gateway',
  brand text,
  name text,
  role text,
  email text,
  phone text,
  website text,
  country text,
  message text,
  status text DEFAULT 'new',
  application_score integer DEFAULT 0,
  priority text DEFAULT 'normal' CHECK (priority IN ('critical','high','normal')),
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_boost_legacy_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type text DEFAULT 'boost_legacy',
  first_name text,
  last_name text,
  email text,
  phone text,
  message text,
  status text DEFAULT 'new' CHECK (status IN ('new','contacted')),
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  unread boolean DEFAULT true,
  pinned boolean DEFAULT false,
  priority text DEFAULT 'normal' CHECK (priority IN ('critical','high','normal')),
  title text NOT NULL,
  text text,
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mxb_visibility_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  members boolean DEFAULT true,
  brand_partners boolean DEFAULT true,
  institutions boolean DEFAULT true,
  producers boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(section)
);
;
