import { FormEvent, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logoImg from "@/assets/logo.png";

export default function SignUp() {
  const { signUp, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!authLoading && user) return <Navigate to="/dossiers" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);
    if (error) {
      toast({ title: "Inscription impossible", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Compte créé", description: "Vous pouvez maintenant vous connecter." });
    navigate("/dossiers", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src={logoImg} alt="Logo" className="h-10 w-auto object-contain" />
          <h1 className="font-display text-2xl font-bold">Créer un compte</h1>
          <p className="text-sm text-muted-foreground">Rejoignez l'équipe commerciale.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card/40 p-6">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nom complet</Label>
            <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer mon compte
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link to="/login" className="text-primary hover:underline">Se connecter</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
