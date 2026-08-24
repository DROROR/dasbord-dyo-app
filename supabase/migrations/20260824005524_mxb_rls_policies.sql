ALTER TABLE mxb_power_list_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_profiles" ON mxb_power_list_profiles FOR SELECT USING (is_public = true);
CREATE POLICY "admin_all_profiles" ON mxb_power_list_profiles USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_brand_partner_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_insert_leads" ON mxb_brand_partner_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_read_leads" ON mxb_brand_partner_leads FOR SELECT USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_boost_legacy_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_insert_boost" ON mxb_boost_legacy_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_read_boost" ON mxb_boost_legacy_leads FOR SELECT USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_power_list_nominations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_insert_nominations" ON mxb_power_list_nominations FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_read_nominations" ON mxb_power_list_nominations FOR SELECT USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_notifications" ON mxb_admin_notifications USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_community_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_published" ON mxb_community_insights FOR SELECT USING (status = 'published');
CREATE POLICY "admin_all_insights" ON mxb_community_insights USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');

ALTER TABLE mxb_visibility_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_read_visibility" ON mxb_visibility_matrix FOR SELECT USING (true);
CREATE POLICY "admin_write_visibility" ON mxb_visibility_matrix FOR ALL USING (auth.jwt() -> 'app_metadata' ->> 'mxb_role' = 'admin');;
