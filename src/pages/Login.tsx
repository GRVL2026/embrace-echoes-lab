import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logoImg from "@/assets/logo.png";

export default function Login() {
  const { signIn, user, isAdmin, isLoading, roleError, refreshRoles } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  if (user && roleError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <p className="text-sm text-muted-foreground">Impossible de charger vos accès.</p>
        <Button onClick={refreshRoles}>Réessayer</Button>
      </div>
    );
  }

  if (user) {
    return <Navigate to={isAdmin ? "/" : "/dossiers"} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast({ title: "Connexion impossible", description: error.message, variant: "destructive" });
      return;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src={logoImg} alt="Logo" className="h-10 w-auto object-contain" />
          <h1 className="font-display text-2xl font-bold">Connexion</h1>
          <p className="text-sm text-muted-foreground">Accédez à vos dossiers commerciaux.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card/40 p-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-12 text-base" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-12 text-base" />
          </div>
          <Button type="submit" className="w-full min-h-12" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Se connecter
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link to="/signup" className="text-primary hover:underline">Créer un compte</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
