CREATE POLICY "user_roles admin insert" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "user_roles admin delete" ON public.user_roles FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "user_roles admin update" ON public.user_roles FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());