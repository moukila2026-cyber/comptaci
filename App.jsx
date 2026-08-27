import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Plus, TrendingUp, TrendingDown, Wallet, LayoutDashboard, PenLine, History, Trash2, Building2, ChevronDown, LogOut, Package, Copy, Minus, Lock, Unlock } from "lucide-react";
import { supabase, configManquante, clientEnErreur } from "./supabaseClient.js";
import AuthScreen from "./AuthScreen.jsx";
import PaiementEnAttente from "./PaiementEnAttente.jsx";

const CATEGORIES_PAR_SECTEUR = {
  restauration: [
    { id: "boissons", label: "Boissons" },
    { id: "nourriture", label: "Nourriture" },
    { id: "personnel", label: "Personnel" },
    { id: "charges_fixes", label: "Charges fixes" },
    { id: "autre", label: "Autre" },
  ],
  quincaillerie: [
    { id: "materiaux", label: "Matériaux de construction" },
    { id: "outillage", label: "Outillage" },
    { id: "plomberie", label: "Plomberie" },
    { id: "electricite", label: "Électricité" },
    { id: "peinture", label: "Peinture & finitions" },
    { id: "personnel", label: "Personnel" },
    { id: "charges_fixes", label: "Charges fixes" },
    { id: "autre", label: "Autre" },
  ],
  boutique: [
    { id: "alimentaire", label: "Produits alimentaires" },
    { id: "hygiene", label: "Produits d'hygiène" },
    { id: "boissons", label: "Boissons" },
    { id: "emballages", label: "Emballages" },
    { id: "personnel", label: "Personnel" },
    { id: "charges_fixes", label: "Charges fixes" },
    { id: "autre", label: "Autre" },
  ],
  pharmacie: [
    { id: "medicaments", label: "Médicaments" },
    { id: "parapharmacie", label: "Parapharmacie" },
    { id: "materiel_medical", label: "Matériel médical" },
    { id: "personnel", label: "Personnel" },
    { id: "charges_fixes", label: "Charges fixes" },
    { id: "autre", label: "Autre" },
  ],
};

const SECTEURS = [
  { id: "restauration", label: "Restauration / Bar / Maquis / Hôtel" },
  { id: "quincaillerie", label: "Quincaillerie" },
  { id: "boutique", label: "Boutique" },
  { id: "pharmacie", label: "Pharmacie" },
];

function categoriesDuSecteur(secteur) {
  return CATEGORIES_PAR_SECTEUR[secteur] || CATEGORIES_PAR_SECTEUR.restauration;
}

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  const names = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
};

const ESTABLISSEMENT_DEFAUT = "Mon établissement";
const STORAGE_KEY = "comptaci:transactions";
const ESTAB_KEY = "comptaci:etablissement";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 780 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 780);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export default function ComptaCi() {
  if (configManquante || clientEnErreur) {
    return (
      <div style={styles.configError}>
        <div style={styles.configErrorCard}>
          <div style={styles.configErrorTitle}>Configuration Supabase invalide</div>
          <p style={styles.configErrorText}>
            {clientEnErreur
              ? "La connexion à Supabase a échoué. Vérifie que le Project URL et la clé sont correctement collés, sans espace ni guillemet en trop."
              : (
                <>
                  Les variables <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> sont
                  absentes ou mal formées (l'URL doit ressembler à https://xxxxx.supabase.co). Vérifie-les dans
                  Vercel → Settings → Environment Variables, puis redéploie.
                </>
              )}
          </p>
        </div>
      </div>
    );
  }
  return <ComptaCiApp />;
}

function ComptaCiApp() {
  const isMobile = useIsMobile();
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const [session, setSession] = useState(null);
  const [verifSession, setVerifSession] = useState(true);
  const [vue, setVue] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [produits, setProduits] = useState([]);
  const [sessionCaisse, setSessionCaisse] = useState(null);
  const [historiqueCaisse, setHistoriqueCaisse] = useState([]);
  const [etablissement, setEtablissement] = useState(null);
  const [role, setRole] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setVerifSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      setChargement(true);
      try {
        const { data: membreRows, error: errMembre } = await supabase
          .from("membres")
          .select("role, etablissement_id, etablissements(*)")
          .eq("user_id", session.user.id)
          .limit(1);
        if (errMembre) throw errMembre;
        const membre = membreRows?.[0];
        const etab = membre?.etablissements || null;
        setEtablissement(etab);
        setRole(membre?.role || null);

        if (etab) {
          const { data: tx, error: errTx } = await supabase
            .from("transactions")
            .select("*")
            .eq("etablissement_id", etab.id)
            .order("date", { ascending: false });
          if (errTx) throw errTx;
          setTransactions(tx || []);

          const { data: prod, error: errProd } = await supabase
            .from("produits")
            .select("*")
            .eq("etablissement_id", etab.id)
            .order("designation", { ascending: true });
          if (errProd) throw errProd;
          setProduits(prod || []);

          const { data: sessions, error: errSessions } = await supabase
            .from("sessions_caisse")
            .select("*")
            .eq("etablissement_id", etab.id)
            .order("date_ouverture", { ascending: false })
            .limit(20);
          if (errSessions) throw errSessions;
          const ouverte = (sessions || []).find((s) => s.statut === "ouverte");
          setSessionCaisse(ouverte || null);
          setHistoriqueCaisse((sessions || []).filter((s) => s.statut === "fermee"));
        }
      } catch (e) {
        console.error("Erreur chargement données:", e);
        setErreur("Impossible de charger vos données. Vérifiez votre connexion.");
      } finally {
        setChargement(false);
      }
    })();
  }, [session]);

  const addTransaction = async (t) => {
    if (!etablissement) return false;
    const { designation, quantite, ...champsTransaction } = t;
    const { data, error } = await supabase
      .from("transactions")
      .insert({ ...champsTransaction, etablissement_id: etablissement.id })
      .select();
    if (error) {
      console.error("Erreur insertion transaction:", error);
      setErreur(`L'enregistrement a échoué : ${error.message}`);
      return false;
    }
    setTransactions([data[0], ...transactions]);

    if (designation && designation.trim() && quantite) {
      await ajusterStock(designation.trim(), parseFloat(quantite) || 0, t.type);
    }
    return true;
  };

  const ajusterStock = async (designation, quantite, type) => {
    const existant = produits.find(
      (p) => p.designation.toLowerCase() === designation.toLowerCase()
    );
    const variation = type === "vente" ? -quantite : quantite;

    if (existant) {
      const nouvelleQuantite = (parseFloat(existant.quantite_stock) || 0) + variation;
      const { data, error } = await supabase
        .from("produits")
        .update({ quantite_stock: nouvelleQuantite, maj_le: new Date().toISOString() })
        .eq("id", existant.id)
        .select();
      if (!error && data?.[0]) {
        setProduits(produits.map((p) => (p.id === existant.id ? data[0] : p)));
      }
    } else if (type === "depense") {
      // Une dépense sur un produit inconnu : on le crée automatiquement en stock
      const { data, error } = await supabase
        .from("produits")
        .insert({ etablissement_id: etablissement.id, designation, quantite_stock: quantite })
        .select();
      if (!error && data?.[0]) {
        setProduits([...produits, data[0]]);
      }
    }
  };

  const addProduit = async (designation, quantite, prixUnitaire) => {
    const { data, error } = await supabase
      .from("produits")
      .insert({
        etablissement_id: etablissement.id,
        designation,
        quantite_stock: quantite,
        prix_unitaire: prixUnitaire || null,
      })
      .select();
    if (error) {
      setErreur("Impossible d'ajouter ce produit au stock.");
      return false;
    }
    setProduits([...produits, data[0]]);
    return true;
  };

  const ajusterQuantiteManuelle = async (id, nouvelleQuantite) => {
    const { data, error } = await supabase
      .from("produits")
      .update({ quantite_stock: nouvelleQuantite, maj_le: new Date().toISOString() })
      .eq("id", id)
      .select();
    if (!error && data?.[0]) {
      setProduits(produits.map((p) => (p.id === id ? data[0] : p)));
    }
  };

  const supprimerProduit = async (id) => {
    const { error } = await supabase.from("produits").delete().eq("id", id);
    if (!error) setProduits(produits.filter((p) => p.id !== id));
  };

  const ouvrirCaisse = async (fondOuverture) => {
    if (!etablissement || !session) return false;
    const { data, error } = await supabase
      .from("sessions_caisse")
      .insert({
        etablissement_id: etablissement.id,
        ouverte_par: session.user.id,
        fond_ouverture: fondOuverture,
      })
      .select()
      .single();
    if (error) {
      setErreur("Impossible d'ouvrir la caisse.");
      return false;
    }
    setSessionCaisse(data);
    return true;
  };

  const fermerCaisse = async (fondFermetureReel, soldeAttendu) => {
    if (!sessionCaisse) return false;
    const ecart = fondFermetureReel - soldeAttendu;
    const { data, error } = await supabase
      .from("sessions_caisse")
      .update({
        fond_fermeture_reel: fondFermetureReel,
        ecart,
        date_fermeture: new Date().toISOString(),
        statut: "fermee",
      })
      .eq("id", sessionCaisse.id)
      .select()
      .single();
    if (error) {
      setErreur("Impossible de fermer la caisse.");
      return false;
    }
    setHistoriqueCaisse([data, ...historiqueCaisse]);
    setSessionCaisse(null);
    return true;
  };

  const deleteTransaction = async (id) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      setErreur("La suppression a échoué.");
      return;
    }
    setTransactions(transactions.filter((t) => t.id !== id));
  };

  const renameEtablissement = async (nom) => {
    if (!etablissement) return;
    const { error } = await supabase.from("etablissements").update({ nom }).eq("id", etablissement.id);
    if (!error) setEtablissement({ ...etablissement, nom });
  };

  const seDeconnecter = async () => {
    await supabase.auth.signOut();
    setTransactions([]);
    setEtablissement(null);
  };

  if (verifSession) {
    return <div style={styles.loading}>Chargement…</div>;
  }

  if (!session) {
    return <AuthScreen onAuthenticated={() => {}} />;
  }

  const essaiExpireLe = etablissement
    ? new Date(new Date(etablissement.date_creation).getTime() + 3 * 24 * 60 * 60 * 1000)
    : null;
  const essaiEnCours = essaiExpireLe ? maintenant < essaiExpireLe.getTime() : false;
  const accesAutorise = etablissement?.abonnement_actif || essaiEnCours;

  if (!chargement && etablissement && !accesAutorise) {
    return (
      <PaiementEnAttente
        etablissement={etablissement}
        essaiTermine={!essaiEnCours}
        onDeconnexion={() => { setSession(null); setEtablissement(null); }}
      />
    );
  }

  const msRestantEssai = essaiExpireLe ? essaiExpireLe.getTime() - maintenant : 0;
  const enEssai = !etablissement?.abonnement_actif && essaiEnCours;

  return (
    <div style={{ ...styles.app, flexDirection: isMobile ? "column" : "row" }}>
      <style>{GLOBAL_CSS}</style>
      <Sidebar vue={vue} setVue={setVue} isMobile={isMobile} onLogout={seDeconnecter} />
      <div style={styles.main}>
        <TopBar
          etablissement={etablissement?.nom || "Mon établissement"}
          onRename={renameEtablissement}
          role={role}
          codeInvitation={etablissement?.code_invitation}
          plan={etablissement?.plan}
        />
        {enEssai && <EssaiBanner msRestant={msRestantEssai} />}
        {erreur && <div style={styles.errorBanner}>{erreur}</div>}
        {chargement ? (
          <div style={styles.loading}>Chargement…</div>
        ) : vue === "dashboard" ? (
          <Dashboard transactions={transactions} isMobile={isMobile} secteur={etablissement?.secteur} etablissement={etablissement} />
        ) : vue === "saisie" ? (
          <Saisie onAdd={addTransaction} secteur={etablissement?.secteur} />
        ) : vue === "stock" ? (
          <Stock
            produits={produits}
            onAdd={addProduit}
            onAjuster={ajusterQuantiteManuelle}
            onSupprimer={supprimerProduit}
          />
        ) : vue === "caisse" ? (
          <Caisse
            sessionCaisse={sessionCaisse}
            historiqueCaisse={historiqueCaisse}
            transactions={transactions}
            onOuvrir={ouvrirCaisse}
            onFermer={fermerCaisse}
          />
        ) : (
          <Historique transactions={transactions} onDelete={deleteTransaction} plan={etablissement?.plan} secteur={etablissement?.secteur} />
        )}
      </div>
    </div>
  );
}


function Sidebar({ vue, setVue, isMobile, onLogout }) {
  const items = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "saisie", label: "Saisie du jour", icon: PenLine },
    { id: "caisse", label: "Caisse", icon: Lock },
    { id: "stock", label: "Stock", icon: Package },
    { id: "historique", label: "Historique", icon: History },
  ];

  if (isMobile) {
    return (
      <aside style={styles.sidebarMobile}>
        <div style={styles.brand}>
          <div style={styles.brandMark}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M2 14L7 6L12 11L18 3" stroke="#E8B65A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={styles.brandName}>ComptaCi</div>
        </div>
        <nav style={styles.navMobile}>
          {items.map((it) => {
            const Icon = it.icon;
            const active = vue === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setVue(it.id)}
                style={{ ...styles.navItemMobile, ...(active ? styles.navItemActive : {}) }}
              >
                <Icon size={16} strokeWidth={2} />
                <span>{it.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        <div style={styles.brandMark}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke="#E8B65A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div style={styles.brandName}>ComptaCi</div>
          <div style={styles.brandSub}>Pilotage financier</div>
        </div>
      </div>
      <nav style={styles.nav}>
        {items.map((it) => {
          const Icon = it.icon;
          const active = vue === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setVue(it.id)}
              style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
            >
              <Icon size={17} strokeWidth={2} />
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>
      <div style={styles.sidebarFooter}>
        <div style={styles.sidebarFooterPattern} />
        <button onClick={onLogout} style={styles.logoutBtn}>
          <LogOut size={14} /> Déconnexion
        </button>
      </div>
    </aside>
  );
}

function EssaiBanner({ msRestant }) {
  const heures = Math.max(0, Math.floor(msRestant / (1000 * 60 * 60)));
  const jours = Math.floor(heures / 24);
  const heuresRestantes = heures % 24;
  return (
    <div style={styles.essaiBanner}>
      Essai gratuit — il vous reste {jours > 0 ? `${jours} j ${heuresRestantes} h` : `${heuresRestantes} h`} avant
      de devoir vous abonner (à partir de 7 000 FCFA / mois).
    </div>
  );
}

function TopBar({ etablissement, onRename, role, codeInvitation, plan }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(etablissement);
  const [inviteOuvert, setInviteOuvert] = useState(false);
  const [copie, setCopie] = useState(false);
  const estProprietaire = role === "proprietaire";
  const estPro = plan === "pro";

  useEffect(() => setVal(etablissement), [etablissement]);

  return (
    <header style={styles.topbar}>
      <div style={styles.topbarLeft}>
        <Building2 size={16} color="#8A8578" />
        {editing && estProprietaire ? (
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (val.trim()) onRename(val.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            style={styles.topbarInput}
          />
        ) : estProprietaire ? (
          <button style={styles.topbarNameBtn} onClick={() => setEditing(true)}>
            {etablissement}
            <ChevronDown size={14} color="#B5AF9E" />
          </button>
        ) : (
          <span style={styles.topbarNameBtn}>{etablissement} · Gérant</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {estProprietaire && codeInvitation && estPro && (
          <div style={{ position: "relative" }}>
            <button style={styles.inviteBtn} onClick={() => setInviteOuvert((v) => !v)}>
              Inviter un gérant
            </button>
            {inviteOuvert && (
              <div style={styles.invitePopover}>
                <div style={styles.invitePopoverLabel}>Code d'invitation à partager</div>
                <div style={styles.inviteCode}>{codeInvitation}</div>
                <p style={styles.invitePopoverText}>
                  Le gérant crée son propre compte via "Rejoindre comme gérant" en utilisant ce code.
                </p>
                <button
                  style={styles.inviteCopyBtn}
                  onClick={() => {
                    navigator.clipboard?.writeText(codeInvitation);
                    setCopie(true);
                    setTimeout(() => setCopie(false), 1500);
                  }}
                >
                  {copie ? "Copié !" : "Copier le code"}
                </button>
              </div>
            )}
          </div>
        )}
        {estProprietaire && !estPro && (
          <div style={styles.upgradeHint}>Plan Pro requis pour inviter un gérant</div>
        )}
        <div style={styles.topbarDate}>
          {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>
    </header>
  );
}

function Dashboard({ transactions, isMobile, secteur, etablissement }) {
  const stats = useMemo(() => computeStats(transactions), [transactions]);
  const [periode, setPeriode] = useState("mois");
  const [copie, setCopie] = useState(false);

  const trend = useMemo(() => buildTrend(transactions, periode), [transactions, periode]);
  const parCategorie = useMemo(() => buildCategorieBreakdown(transactions, secteur), [transactions, secteur]);

  const copierBilan = () => {
    const moisLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const texte = [
      `Bilan ${moisLabel} — ${etablissement?.nom || "Mon établissement"}`,
      ``,
      `Chiffre d'affaires : ${fmt(stats.caMois)} FCFA`,
      `Dépenses : ${fmt(stats.depMois)} FCFA`,
      `Résultat net : ${stats.resultatMois >= 0 ? "+" : ""}${fmt(stats.resultatMois)} FCFA`,
      `Marge : ${stats.margeMois.toFixed(0)}%`,
      `TVA à provisionner (estimation) : ${fmt(stats.tvaMois)} FCFA`,
      ``,
      `Généré via ComptaCi`,
    ].join("\n");
    navigator.clipboard?.writeText(texte);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  };

  return (
    <div style={styles.page}>
      <div style={styles.dashboardHeader}>
        <button onClick={copierBilan} style={styles.copyBtn}>
          <Copy size={14} /> {copie ? "Bilan copié !" : "Copier le bilan mensuel"}
        </button>
      </div>
      <div className="kpi-row">
        <KpiCard
          label="Chiffre d'affaires"
          value={stats.caMois}
          accent="gold"
          icon={<Wallet size={16} />}
          sub={`${stats.caMoisPct >= 0 ? "+" : ""}${stats.caMoisPct.toFixed(0)}% vs mois dernier`}
        />
        <KpiCard
          label="Dépenses"
          value={stats.depMois}
          accent="clay"
          icon={<TrendingDown size={16} />}
          sub={`${stats.depMoisPct >= 0 ? "+" : ""}${stats.depMoisPct.toFixed(0)}% vs mois dernier`}
        />
        <KpiCard
          label="Résultat net"
          value={stats.resultatMois}
          accent={stats.resultatMois >= 0 ? "teal" : "clay"}
          icon={stats.resultatMois >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          sub={`Marge ${stats.margeMois.toFixed(0)}%`}
          hero
        />
        <KpiCard
          label="TVA à provisionner"
          value={stats.tvaMois}
          accent="ink"
          icon={<Wallet size={16} />}
          sub="Estimation à 18%, indicative"
        />
      </div>

      <div className="grid-two">
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Évolution</div>
              <div style={styles.cardCaption}>Recettes et dépenses, 6 derniers mois</div>
            </div>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ca" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4A24C" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#D4A24C" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dep" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C1502E" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#C1502E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EDE7DA" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8A8578" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8A8578" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(v) => `${fmt(v)} FCFA`}
                  contentStyle={{ fontFamily: "Inter, sans-serif", fontSize: 12, border: "1px solid #EDE7DA", borderRadius: 8 }}
                />
                <Area type="monotone" dataKey="ca" stroke="#D4A24C" strokeWidth={2} fill="url(#ca)" name="Recettes" />
                <Area type="monotone" dataKey="dep" stroke="#C1502E" strokeWidth={2} fill="url(#dep)" name="Dépenses" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Répartition des dépenses</div>
              <div style={styles.cardCaption}>Ce mois-ci, par catégorie</div>
            </div>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={parCategorie} layout="vertical" margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: 12, fill: "#3A3628" }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip formatter={(v) => `${fmt(v)} FCFA`} contentStyle={{ fontFamily: "Inter, sans-serif", fontSize: 12, border: "1px solid #EDE7DA", borderRadius: 8 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#16213E" barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {transactions.length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyTitle}>Aucune donnée pour l'instant</div>
          <div style={styles.emptyText}>Va dans « Saisie du jour » pour enregistrer tes premières ventes et dépenses.</div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent, icon, sub, hero }) {
  const colors = {
    gold: { fg: "#B4801F", bg: "#FBF3E2" },
    clay: { fg: "#B4432A", bg: "#FBEBE4" },
    teal: { fg: "#186B4E", bg: "#E4F2EC" },
    ink: { fg: "#16213E", bg: "#EAECF3" },
  }[accent];
  return (
    <div style={{ ...styles.kpiCard, ...(hero ? styles.kpiCardHero : {}) }}>
      <div style={styles.kpiTop}>
        <span style={styles.kpiLabel}>{label}</span>
        <span style={{ ...styles.kpiIcon, color: colors.fg, background: colors.bg }}>{icon}</span>
      </div>
      <div style={{ ...styles.kpiValue, color: hero ? colors.fg : "#16213E" }}>
        {value < 0 ? "-" : ""}
        {fmt(Math.abs(value))} <span style={styles.kpiUnit}>FCFA</span>
      </div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function Saisie({ onAdd, secteur }) {
  const categories = categoriesDuSecteur(secteur);
  const [type, setType] = useState("vente");
  const [designation, setDesignation] = useState("");
  const [quantite, setQuantite] = useState("1");
  const [prixUnitaire, setPrixUnitaire] = useState("");
  const [categorie, setCategorie] = useState(categories[0].id);
  const [date, setDate] = useState(todayISO());
  const [confirme, setConfirme] = useState(false);
  const [erreurLocale, setErreurLocale] = useState("");
  const [enCours, setEnCours] = useState(false);

  const totalCalcule = (parseFloat(quantite) || 0) * (parseFloat(prixUnitaire) || 0);

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!totalCalcule || totalCalcule <= 0) return;
    setErreurLocale("");
    setEnCours(true);
    const succes = await onAdd({
      type,
      montant: totalCalcule,
      categorie: type === "depense" ? categorie : "vente",
      note: [designation.trim(), `Qté: ${quantite || 0}`, `PU: ${fmt(parseFloat(prixUnitaire) || 0)} FCFA`].filter(Boolean).join(" — "),
      date,
      designation: designation.trim(),
      quantite,
    });
    setEnCours(false);
    if (succes) {
      setDesignation("");
      setQuantite("1");
      setPrixUnitaire("");
      setConfirme(true);
      setTimeout(() => setConfirme(false), 1800);
    } else {
      setErreurLocale("L'enregistrement a échoué. Vérifiez votre connexion et réessayez.");
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: 520, width: "100%" }}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>Enregistrer un mouvement</div>
            <div style={styles.cardCaption}>Une vente ou une dépense du jour</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={styles.toggleRow}>
            <button
              type="button"
              onClick={() => setType("vente")}
              style={{ ...styles.toggleBtn, ...(type === "vente" ? styles.toggleBtnActiveVente : {}) }}
            >
              Vente (entrée)
            </button>
            <button
              type="button"
              onClick={() => setType("depense")}
              style={{ ...styles.toggleBtn, ...(type === "depense" ? styles.toggleBtnActiveDepense : {}) }}
            >
              Dépense (sortie)
            </button>
          </div>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>
              {type === "vente" ? "Désignation du produit vendu" : "Désignation de l'achat / de la dépense"}
            </span>
            <input
              type="text"
              placeholder={type === "vente" ? "Ex : Riz KC 50 kg" : "Ex : Sac de ciment 50 kg"}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              style={styles.input}
            />
          </label>

          {type === "depense" && (
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Catégorie</span>
              <select value={categorie} onChange={(e) => setCategorie(e.target.value)} style={styles.select}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          )}

          <div style={styles.qtyRow}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Quantité</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="1"
                value={quantite}
                onChange={(e) => setQuantite(e.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Prix unitaire (FCFA)</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="0"
                value={prixUnitaire}
                onChange={(e) => setPrixUnitaire(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.totalBox}>
            <span style={styles.totalLabel}>Total</span>
            <span style={styles.totalValue}>{fmt(totalCalcule)} FCFA</span>
          </div>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
          </label>

          <button type="button" onClick={submit} disabled={enCours} style={styles.submitBtn}>
            <Plus size={16} /> {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          {confirme && <div style={styles.confirmMsg}>Mouvement enregistré.</div>}
          {erreurLocale && <div style={styles.erreurLocale}>{erreurLocale}</div>}
        </div>
      </div>
    </div>
  );
}

function Caisse({ sessionCaisse, historiqueCaisse, transactions, onOuvrir, onFermer }) {
  const [fondOuverture, setFondOuverture] = useState("");
  const [fondCompte, setFondCompte] = useState("");
  const [modeFermeture, setModeFermeture] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const mouvementsDepuisOuverture = sessionCaisse
    ? transactions.filter((t) => new Date(t.date + "T00:00:00") >= new Date(new Date(sessionCaisse.date_ouverture).toDateString()))
    : [];
  const ventesSession = mouvementsDepuisOuverture.filter((t) => t.type === "vente").reduce((a, t) => a + t.montant, 0);
  const depensesSession = mouvementsDepuisOuverture.filter((t) => t.type === "depense").reduce((a, t) => a + t.montant, 0);
  const soldeAttendu = sessionCaisse ? (parseFloat(sessionCaisse.fond_ouverture) || 0) + ventesSession - depensesSession : 0;

  const ouvrir = async () => {
    if (!fondOuverture) return;
    setEnCours(true);
    await onOuvrir(parseFloat(fondOuverture) || 0);
    setEnCours(false);
    setFondOuverture("");
  };

  const fermer = async () => {
    if (!fondCompte) return;
    setEnCours(true);
    const succes = await onFermer(parseFloat(fondCompte) || 0, soldeAttendu);
    setEnCours(false);
    if (succes) {
      setFondCompte("");
      setModeFermeture(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>Caisse</div>
            <div style={styles.cardCaption}>
              {sessionCaisse ? "Caisse actuellement ouverte" : "Aucune session de caisse en cours"}
            </div>
          </div>
        </div>

        {!sessionCaisse ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Fond de caisse de départ (FCFA)</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="0"
                value={fondOuverture}
                onChange={(e) => setFondOuverture(e.target.value)}
                style={styles.inputBig}
              />
            </label>
            <button onClick={ouvrir} disabled={enCours} style={styles.submitBtn}>
              <Unlock size={16} /> {enCours ? "Ouverture…" : "Ouvrir la caisse"}
            </button>
          </div>
        ) : (
          <>
            <div style={styles.caisseSummary}>
              <div style={styles.caisseSummaryRow}>
                <span>Fond de départ</span>
                <strong>{fmt(sessionCaisse.fond_ouverture)} FCFA</strong>
              </div>
              <div style={styles.caisseSummaryRow}>
                <span>+ Ventes depuis l'ouverture</span>
                <strong style={{ color: "#186B4E" }}>{fmt(ventesSession)} FCFA</strong>
              </div>
              <div style={styles.caisseSummaryRow}>
                <span>− Dépenses depuis l'ouverture</span>
                <strong style={{ color: "#B4432A" }}>{fmt(depensesSession)} FCFA</strong>
              </div>
              <div style={{ ...styles.caisseSummaryRow, ...styles.caisseSummaryTotal }}>
                <span>Solde attendu en caisse</span>
                <strong>{fmt(soldeAttendu)} FCFA</strong>
              </div>
            </div>

            {!modeFermeture ? (
              <button onClick={() => setModeFermeture(true)} style={{ ...styles.submitBtn, marginTop: 16 }}>
                <Lock size={16} /> Fermer la caisse
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, maxWidth: 360 }}>
                <label style={styles.field}>
                  <span style={styles.fieldLabel}>Montant réellement compté en caisse (FCFA)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    value={fondCompte}
                    onChange={(e) => setFondCompte(e.target.value)}
                    style={styles.inputBig}
                  />
                </label>
                {fondCompte && (
                  <div
                    style={{
                      ...styles.ecartBox,
                      ...((parseFloat(fondCompte) - soldeAttendu) === 0
                        ? styles.ecartOk
                        : (parseFloat(fondCompte) - soldeAttendu) > 0
                        ? styles.ecartPositif
                        : styles.ecartNegatif),
                    }}
                  >
                    Écart : {(parseFloat(fondCompte) - soldeAttendu) >= 0 ? "+" : ""}
                    {fmt(parseFloat(fondCompte) - soldeAttendu)} FCFA
                  </div>
                )}
                <button onClick={fermer} disabled={enCours} style={styles.submitBtn}>
                  {enCours ? "Fermeture…" : "Confirmer la fermeture"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {historiqueCaisse.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Historique des clôtures</div>
              <div style={styles.cardCaption}>{historiqueCaisse.length} session{historiqueCaisse.length > 1 ? "s" : ""} fermée{historiqueCaisse.length > 1 ? "s" : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {historiqueCaisse.map((s) => (
              <div key={s.id} style={styles.txRow}>
                <div style={styles.txInfo}>
                  <div style={styles.txLabel}>
                    {new Date(s.date_ouverture).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  </div>
                  <div style={styles.txNote}>Fond départ : {fmt(s.fond_ouverture)} FCFA · Compté : {fmt(s.fond_fermeture_reel)} FCFA</div>
                </div>
                <div style={{ ...styles.txAmount, color: s.ecart === 0 ? "#186B4E" : Math.abs(s.ecart) > 0 ? "#B4432A" : "#16213E" }}>
                  {s.ecart >= 0 ? "+" : ""}{fmt(s.ecart)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stock({ produits, onAdd, onAjuster, onSupprimer }) {
  const [designation, setDesignation] = useState("");
  const [quantite, setQuantite] = useState("");
  const [prixUnitaire, setPrixUnitaire] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const submit = async () => {
    if (!designation.trim() || !quantite) return;
    setEnCours(true);
    const succes = await onAdd(designation.trim(), parseFloat(quantite) || 0, parseFloat(prixUnitaire) || null);
    setEnCours(false);
    if (succes) {
      setDesignation("");
      setQuantite("");
      setPrixUnitaire("");
      setOuvert(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>Stock</div>
            <div style={styles.cardCaption}>
              {produits.length} produit{produits.length > 1 ? "s" : ""} suivi{produits.length > 1 ? "s" : ""} — se
              met à jour automatiquement avec vos ventes et dépenses
            </div>
          </div>
          <button style={styles.inviteBtn} onClick={() => setOuvert((v) => !v)}>
            {ouvert ? "Annuler" : "+ Ajouter un produit"}
          </button>
        </div>

        {ouvert && (
          <div style={styles.stockForm}>
            <input
              type="text"
              placeholder="Désignation (ex : Riz KC 50 kg)"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              style={{ ...styles.input, flex: "1 1 200px" }}
            />
            <input
              type="number"
              placeholder="Quantité en stock"
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              style={{ ...styles.input, flex: "1 1 130px" }}
            />
            <input
              type="number"
              placeholder="Prix unitaire (facultatif)"
              value={prixUnitaire}
              onChange={(e) => setPrixUnitaire(e.target.value)}
              style={{ ...styles.input, flex: "1 1 150px" }}
            />
            <button onClick={submit} disabled={enCours} style={{ ...styles.submitBtn, flex: "1 1 100%" }}>
              {enCours ? "Ajout…" : "Ajouter au stock"}
            </button>
          </div>
        )}

        {produits.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>Aucun produit suivi</div>
            <div style={styles.emptyText}>
              Ajoutez vos produits ici pour suivre leur stock automatiquement à chaque vente ou dépense portant
              le même nom.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {produits.map((p) => (
              <div key={p.id} style={styles.stockRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.stockLabel}>{p.designation}</div>
                  {p.prix_unitaire && (
                    <div style={styles.stockSub}>{fmt(p.prix_unitaire)} FCFA / unité</div>
                  )}
                </div>
                <button
                  onClick={() => onAjuster(p.id, (parseFloat(p.quantite_stock) || 0) - 1)}
                  style={styles.stockAdjustBtn}
                >
                  <Minus size={13} />
                </button>
                <div style={{ ...styles.stockQty, ...(p.quantite_stock <= 0 ? styles.stockQtyLow : {}) }}>
                  {fmt(p.quantite_stock)}
                </div>
                <button
                  onClick={() => onAjuster(p.id, (parseFloat(p.quantite_stock) || 0) + 1)}
                  style={styles.stockAdjustBtn}
                >
                  <Plus size={13} />
                </button>
                <button onClick={() => onSupprimer(p.id)} style={styles.txDelete} aria-label="Supprimer">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Historique({ transactions, onDelete, plan, secteur }) {
  const categories = categoriesDuSecteur(secteur);
  const limite30j = plan !== "pro";
  const seuil = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const transactionsVisibles = limite30j
    ? transactions.filter((t) => new Date(t.date).getTime() >= seuil)
    : transactions;
  const masquees = transactions.length - transactionsVisibles.length;

  const groups = useMemo(() => {
    const byDate = {};
    for (const t of transactionsVisibles) {
      (byDate[t.date] ||= []).push(t);
    }
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [transactionsVisibles]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>Historique des mouvements</div>
            <div style={styles.cardCaption}>
              {transactionsVisibles.length} enregistrement{transactionsVisibles.length > 1 ? "s" : ""}
              {limite30j ? " (30 derniers jours)" : ""}
            </div>
          </div>
        </div>

        {limite30j && masquees > 0 && (
          <div style={styles.upgradeNotice}>
            {masquees} enregistrement{masquees > 1 ? "s" : ""} plus ancien{masquees > 1 ? "s" : ""} masqué
            {masquees > 1 ? "s" : ""} — passez au plan Pro pour l'historique complet.
          </div>
        )}

        {groups.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>Rien à afficher</div>
            <div style={styles.emptyText}>Les mouvements que tu enregistres apparaîtront ici.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {groups.map(([date, items]) => (
              <div key={date}>
                <div style={styles.dateHeader}>
                  {new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((t) => (
                    <div key={t.id} style={styles.txRow}>
                      <div style={{ ...styles.txDot, background: t.type === "vente" ? "#186B4E" : "#B4432A" }} />
                      <div style={styles.txInfo}>
                        <div style={styles.txLabel}>
                          {t.type === "vente" ? "Vente" : categories.find((c) => c.id === t.categorie)?.label || "Dépense"}
                        </div>
                        {t.note && <div style={styles.txNote}>{t.note}</div>}
                      </div>
                      <div style={{ ...styles.txAmount, color: t.type === "vente" ? "#186B4E" : "#B4432A" }}>
                        {t.type === "vente" ? "+" : "-"}{fmt(t.montant)}
                      </div>
                      <button onClick={() => onDelete(t.id)} style={styles.txDelete} aria-label="Supprimer">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- calculs ----

function computeStats(transactions) {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const sum = (key, type) =>
    transactions.filter((t) => monthKey(t.date) === key && t.type === type).reduce((a, t) => a + t.montant, 0);

  const caMois = sum(curKey, "vente");
  const depMois = sum(curKey, "depense");
  const caPrev = sum(prevKey, "vente");
  const depPrev = sum(prevKey, "depense");
  const resultatMois = caMois - depMois;
  const margeMois = caMois > 0 ? (resultatMois / caMois) * 100 : 0;
  const tvaMois = caMois * 0.18;

  const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0);

  return {
    caMois,
    depMois,
    resultatMois,
    margeMois,
    tvaMois,
    caMoisPct: pct(caMois, caPrev),
    depMoisPct: pct(depMois, depPrev),
  };
}

function buildTrend(transactions) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(key);
  }
  return months.map((key) => {
    const ca = transactions.filter((t) => monthKey(t.date) === key && t.type === "vente").reduce((a, t) => a + t.montant, 0);
    const dep = transactions.filter((t) => monthKey(t.date) === key && t.type === "depense").reduce((a, t) => a + t.montant, 0);
    return { label: monthLabel(key), ca, dep };
  });
}

function buildCategorieBreakdown(transactions, secteur) {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return categoriesDuSecteur(secteur).map((c) => ({
    label: c.label,
    value: transactions
      .filter((t) => monthKey(t.date) === curKey && t.type === "depense" && t.categorie === c.id)
      .reduce((a, t) => a + t.montant, 0),
  })).sort((a, b) => b.value - a.value);
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');

* { box-sizing: border-box; }

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.grid-two {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
}

@media (max-width: 980px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .grid-two { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .kpi-row { grid-template-columns: 1fr; }
}
`;

const styles = {
  app: {
    display: "flex",
    minHeight: "100vh",
    background: "#FBF7F0",
    fontFamily: "'Inter', sans-serif",
    color: "#16213E",
  },
  sidebar: {
    width: 220,
    background: "#16213E",
    color: "#FBF7F0",
    display: "flex",
    flexDirection: "column",
    padding: "24px 16px",
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "0 8px 28px" },
  brandMark: {
    width: 32, height: 32, borderRadius: 8, background: "rgba(232,182,90,0.12)",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" },
  brandSub: { fontSize: 10.5, color: "#9AA4C4", marginTop: 1 },
  nav: { display: "flex", flexDirection: "column", gap: 2 },
  navItem: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8,
    background: "transparent", border: "none", color: "#B7BFDA", fontSize: 13.5, fontWeight: 500,
    cursor: "pointer", textAlign: "left", fontFamily: "'Inter', sans-serif",
  },
  navItemActive: { background: "rgba(232,182,90,0.14)", color: "#F3D9A0" },
  sidebarMobile: {
    width: "100%", background: "#16213E", color: "#FBF7F0",
    padding: "14px 16px", flexShrink: 0,
  },
  navMobile: { display: "flex", gap: 6, marginTop: 12, overflowX: "auto" },
  navItemMobile: {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8,
    background: "transparent", border: "none", color: "#B7BFDA", fontSize: 12.5, fontWeight: 500,
    cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'Inter', sans-serif", flexShrink: 0,
  },
  sidebarFooter: { marginTop: "auto", paddingTop: 20 },
  sidebarFooterPattern: {
    height: 2, background: "linear-gradient(90deg, #E8B65A 0%, transparent 100%)", marginBottom: 12, opacity: 0.5,
  },
  sidebarFooterText: { fontSize: 11, color: "#7C87AC", lineHeight: 1.5 },
  logoutBtn: {
    display: "flex", alignItems: "center", gap: 8, background: "none", border: "none",
    color: "#9AA4C4", fontSize: 12.5, cursor: "pointer", padding: "8px 8px", fontFamily: "'Inter', sans-serif",
  },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, width: "100%" },
  topbar: {
    display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6,
    padding: "14px 20px", borderBottom: "1px solid #EDE7DA", background: "#FFFEFB",
  },
  topbarLeft: { display: "flex", alignItems: "center", gap: 8 },
  topbarNameBtn: {
    display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, color: "#16213E", cursor: "pointer", padding: 0,
  },
  topbarInput: {
    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, color: "#16213E",
    border: "none", borderBottom: "1px solid #D4A24C", outline: "none", background: "transparent",
  },
  topbarDate: { fontSize: 12.5, color: "#8A8578", textTransform: "capitalize" },
  inviteBtn: {
    padding: "7px 12px", borderRadius: 8, border: "1px solid #E4DDD0", background: "#FFFEFB",
    fontSize: 12, fontWeight: 600, color: "#16213E", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  upgradeHint: { fontSize: 11.5, color: "#B4801F", background: "#FBF3E2", padding: "6px 10px", borderRadius: 8 },
  invitePopover: {
    position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#FFFEFB",
    border: "1px solid #EDE7DA", borderRadius: 12, padding: 16, width: 260,
    boxShadow: "0 8px 24px rgba(22,33,62,0.12)", zIndex: 10,
  },
  invitePopoverLabel: { fontSize: 11.5, fontWeight: 600, color: "#8A8578", marginBottom: 8 },
  inviteCode: {
    fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: "#16213E",
    letterSpacing: "0.08em", textAlign: "center", background: "#FBF3E2", borderRadius: 8, padding: "10px 0", marginBottom: 10,
  },
  invitePopoverText: { fontSize: 11.5, color: "#8A8578", lineHeight: 1.5, marginBottom: 10 },
  inviteCopyBtn: {
    width: "100%", padding: "8px 0", borderRadius: 8, border: "none", background: "#16213E",
    color: "#F3D9A0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  errorBanner: { margin: "16px 32px 0", padding: "10px 14px", background: "#FBEBE4", color: "#8A3420", borderRadius: 8, fontSize: 13 },
  essaiBanner: { margin: "16px 32px 0", padding: "10px 14px", background: "#FBF3E2", color: "#8A6420", borderRadius: 8, fontSize: 12.5, fontWeight: 500 },
  loading: { padding: 40, color: "#8A8578", fontSize: 14 },
  configError: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FBF7F0", padding: 20,
  },
  configErrorCard: {
    background: "#FFFEFB", border: "1px solid #EABBA9", borderRadius: 14, padding: 26, maxWidth: 440,
  },
  configErrorTitle: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#B4432A", marginBottom: 10 },
  configErrorText: { fontSize: 13.5, color: "#5C5748", lineHeight: 1.6 },
  page: { padding: "20px 20px 40px", display: "flex", flexDirection: "column", gap: 20, minWidth: 0 },
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  kpiCard: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 14, padding: "18px 18px 16px",
    display: "flex", flexDirection: "column", gap: 10,
  },
  kpiCardHero: { borderColor: "#E8D9B5", boxShadow: "0 2px 14px rgba(212,162,76,0.10)" },
  kpiTop: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  kpiLabel: { fontSize: 12, color: "#8A8578", fontWeight: 500 },
  kpiIcon: { width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" },
  kpiValue: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em" },
  kpiUnit: { fontSize: 13, fontWeight: 400, color: "#8A8578" },
  kpiSub: { fontSize: 11.5, color: "#8A8578" },
  gridTwo: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 },
  card: { background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 14, padding: 20 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardTitle: { fontFamily: "'Fraunces', serif", fontSize: 15.5, fontWeight: 600, color: "#16213E" },
  cardCaption: { fontSize: 12, color: "#8A8578", marginTop: 2 },
  emptyState: { padding: "36px 20px", textAlign: "center", border: "1px dashed #E4DDD0", borderRadius: 12 },
  emptyTitle: { fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: "#8A8578" },
  upgradeNotice: {
    fontSize: 12, color: "#B4801F", background: "#FBF3E2", padding: "10px 12px",
    borderRadius: 9, marginBottom: 16,
  },
  stockForm: {
    display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18,
    padding: 14, background: "#FBF9F4", borderRadius: 10,
  },
  stockRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#FBF9F4",
  },
  stockLabel: { fontSize: 13.5, fontWeight: 500, color: "#16213E" },
  stockSub: { fontSize: 11.5, color: "#8A8578", marginTop: 1 },
  stockAdjustBtn: {
    width: 26, height: 26, borderRadius: 7, border: "1px solid #E4DDD0", background: "#FFFEFB",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#16213E",
  },
  stockQty: {
    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: "#16213E", minWidth: 40, textAlign: "center",
  },
  stockQtyLow: { color: "#B4432A" },
  caisseSummary: { display: "flex", flexDirection: "column", gap: 8, background: "#FBF9F4", borderRadius: 10, padding: 16, maxWidth: 360 },
  caisseSummaryRow: { display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#5C5748" },
  caisseSummaryTotal: { borderTop: "1px solid #EDE7DA", paddingTop: 10, marginTop: 4, fontSize: 14.5, color: "#16213E" },
  ecartBox: { padding: "10px 14px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, textAlign: "center" },
  ecartOk: { background: "#E4F2EC", color: "#186B4E" },
  ecartPositif: { background: "#FBF3E2", color: "#B4801F" },
  ecartNegatif: { background: "#FBEBE4", color: "#B4432A" },
  dashboardHeader: { display: "flex", justifyContent: "flex-end" },
  copyBtn: {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
    border: "1px solid #E4DDD0", background: "#FFFEFB", fontSize: 12.5, fontWeight: 600,
    color: "#16213E", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  toggleRow: { display: "flex", gap: 8 },
  toggleBtn: {
    flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #E4DDD0", background: "#FFFEFB",
    fontSize: 13.5, fontWeight: 600, color: "#8A8578", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  toggleBtnActiveVente: { background: "#E4F2EC", borderColor: "#B7DBCA", color: "#186B4E" },
  toggleBtnActiveDepense: { background: "#FBEBE4", borderColor: "#EABBA9", color: "#B4432A" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: 600, color: "#5C5748" },
  input: {
    padding: "10px 12px", borderRadius: 9, border: "1px solid #E4DDD0", fontSize: 14,
    fontFamily: "'Inter', sans-serif", color: "#16213E", outline: "none",
  },
  inputBig: {
    padding: "12px 14px", borderRadius: 9, border: "1px solid #E4DDD0", fontSize: 22,
    fontFamily: "'Fraunces', serif", fontWeight: 600, color: "#16213E", outline: "none",
  },
  select: {
    padding: "10px 12px", borderRadius: 9, border: "1px solid #E4DDD0", fontSize: 14,
    fontFamily: "'Inter', sans-serif", color: "#16213E", outline: "none", background: "#FFFEFB",
  },
  submitBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "12px 0", borderRadius: 9, border: "none", background: "#16213E", color: "#F3D9A0",
    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  confirmMsg: { fontSize: 12.5, color: "#186B4E", textAlign: "center" },
  erreurLocale: { fontSize: 12.5, color: "#B4432A", textAlign: "center", background: "#FBEBE4", padding: "8px 10px", borderRadius: 8 },
  qtyRow: { display: "flex", gap: 12 },
  totalBox: {
    display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FBF3E2",
    borderRadius: 9, padding: "12px 14px",
  },
  totalLabel: { fontSize: 12.5, fontWeight: 600, color: "#8A6420" },
  totalValue: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "#16213E" },
  dateHeader: { fontSize: 12.5, fontWeight: 600, color: "#8A8578", textTransform: "capitalize", marginBottom: 8 },
  txRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9,
    background: "#FBF9F4",
  },
  txDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  txInfo: { flex: 1, minWidth: 0 },
  txLabel: { fontSize: 13.5, fontWeight: 500, color: "#16213E" },
  txNote: { fontSize: 11.5, color: "#8A8578", marginTop: 1 },
  txAmount: { fontFamily: "'Fraunces', serif", fontSize: 14.5, fontWeight: 600 },
  txDelete: { background: "none", border: "none", color: "#B5AF9E", cursor: "pointer", padding: 4 },
};
