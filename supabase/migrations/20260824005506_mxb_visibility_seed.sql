INSERT INTO mxb_visibility_matrix (section, members, brand_partners, institutions, producers)
VALUES 
  ('fov', true, true, true, false),
  ('lacroisette', true, true, true, false),
  ('awards', true, true, false, false),
  ('academia', true, false, false, false),
  ('proyectos', true, true, false, true),
  ('anuncios', true, true, true, false)
ON CONFLICT (section) DO NOTHING;;
