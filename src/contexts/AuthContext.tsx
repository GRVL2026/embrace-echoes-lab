import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "direction" | "commercial";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  loading: boolean;
  rolesLoaded: boolean;
  roleError: string | null;
  roles: AppRole[];
  isAdmin: boolean;
  isDirection: boolean;
  canAccessGaia: boolean;
  canAccessDashboard: boolean;
  copilotEnabled: boolean;
  dashboardEnabled: boolean;
  refreshRoles: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};


const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [copilotEnabled, setCopilotEnabled] = useState<boolean>(true);
  const [rolesResolvedFor, setRolesResolvedFor] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRefresh, setRoleRefresh] = useState(0);


  useEffect(() => {
    let currentUserId: string | null = null;

    const applySession = (s: Session | null) => {
      const nextId = s?.user?.id ?? null;
      if (nextId === currentUserId) {
        // Simple token refresh with the same user — just update the session
        // silently, DO NOT touch the user reference (would remount the tree).
        setSession((prev) => (prev === s ? prev : s));
        return;
      }
      currentUserId = nextId;
      setSession(s);
      setUser(s?.user ?? null);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // TOKEN_REFRESHED / USER_UPDATED with the same user must not trigger a
      // full app re-render (skeletons on tab-refocus bug).
      if (event === "TOKEN_REFRESHED" && s?.user?.id === currentUserId) {
        setSession((prev) => (prev === s ? prev : s));
        return;
      }
      applySession(s);
    });

    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setCopilotEnabled(true);
      setRolesResolvedFor(null);
      setRoleError(null);
      return;
    }

    const userId = user.id;
    if (rolesResolvedFor === userId && roleRefresh === 0) return;

    let active = true;
    setRoleError(null);

    (async () => {
      const [{ data, error }, { data: profile }] = await Promise.all([
        (supabase as any).from("user_roles").select("role").eq("user_id", userId),
        (supabase as any).from("profiles").select("copilote_enabled").eq("id", userId).maybeSingle(),
      ]);

      if (!active) return;
      if (error) {
        setRoleError(error.message);
        setRolesResolvedFor(userId);
        return;
      }

      setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
      setCopilotEnabled(profile?.copilote_enabled !== false);
      setRolesResolvedFor(userId);
    })();


    return () => {
      active = false;
    };
    // Depend on user.id (not user reference) so a new user object with the
    // same id doesn't retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, roleRefresh]);

  const rolesLoaded = !user || rolesResolvedFor === user.id;
  const isLoading = authLoading || !rolesLoaded;
  const refreshRoles = () => setRoleRefresh((value) => value + 1);

  const isAdmin = roles.includes("admin");
  const isDirection = roles.includes("direction");
  const canAccessGaia = isAdmin || isDirection;

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp: AuthContextValue["signUp"] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        loading: isLoading,
        rolesLoaded,
        roleError,
        roles,
        isAdmin,
        isDirection,
        canAccessGaia,
        copilotEnabled,
        refreshRoles,

        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
