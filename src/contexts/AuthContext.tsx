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
  const [rolesResolvedFor, setRolesResolvedFor] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRefresh, setRoleRefresh] = useState(0);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setRolesResolvedFor(null);
      setRoleError(null);
      return;
    }

    let active = true;
    const userId = user.id;
    setRoles([]);
    setRolesResolvedFor(null);
    setRoleError(null);

    (async () => {
      const { data, error } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      if (!active) return;
      if (error) {
        setRoleError(error.message);
        setRolesResolvedFor(userId);
        return;
      }

      setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
      setRolesResolvedFor(userId);
    })();

    return () => {
      active = false;
    };
  }, [user, roleRefresh]);

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
