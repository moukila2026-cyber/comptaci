import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Plus, TrendingUp, TrendingDown, Wallet, LayoutDashboard, PenLine, History, Trash2, Building2, ChevronDown, LogOut, Package, Copy, Minus, Lock, Unlock, Phone, MessageCircle, CreditCard } from "lucide-react";
import { supabase, configManquante, clientEnErreur } from "./supabaseClient.js";
import AuthScreen from "./AuthScreen.jsx";
import PaiementEnAttente from "./PaiementEnAttente.jsx";
import LanguageSelector from "./LanguageSelector.jsx";
import { traducteur, getLangueInitiale, sauvegarderLangue, RTL_LANGUES } from "./i18n.js";
import PaiementWave from "./PaiementWave.jsx";
import { wallpaperStyle } from "./wallpaper.js";

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

const SECTEURS_IDS = ["restauration", "quincaillerie", "boutique", "pharmacie"];
function secteursTraduits(t) {
  return SECTEURS_IDS.map((id) => ({ id, label: t(`secteur_${id}`) }));
}

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
  const [langue, setLangueState] = useState(getLangueInitiale());
  const t = traducteur(langue);

  useEffect(() => {
    document.documentElement.lang = langue;
    document.documentElement.dir = RTL_LANGUES.includes(langue) ? "rtl" : "ltr";
  }, [langue]);

  const setLangue = (l) => {
    setLangueState(l);
    sauvegarderLangue(l);
  };

  if (configManquante || clientEnErreur) {
    return (
      <div style={styles.configError}>
        <div style={styles.configErrorCard}>
          <div style={styles.configErrorTitle}>{t("config_manquante_titre")}</div>
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
  return <ComptaCiApp langue={langue} setLangue={setLangue} t={t} />;
}

function ComptaCiApp({ langue, setLangue, t }) {
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
  const [fournisseurs, setFournisseurs] = useState([]);
  const [nombreGerants, setNombreGerants] = useState(0);
  const [sessionCaisse, setSessionCaisse] = useState(null);
  const [historiqueCaisse, setHistoriqueCaisse] = useState([]);
  const [etablissement, setEtablissement] = useState(null);
  const [role, setRole] = useState(null);
  const [mesEtablissements, setMesEtablissements] = useState([]);
  const [listeChargee, setListeChargee] = useState(false);
  const [etablissementActifId, setEtablissementActifId] = useState(null);
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

  // Charge la liste de tous les établissements accessibles à ce compte
  useEffect(() => {
    if (!session) return;
    (async () => {
      setChargement(true);
      try {
        const { data: membreRows, error: errMembre } = await supabase
          .from("membres")
          .select("role, etablissement_id, etablissements(*)")
          .eq("user_id", session.user.id);
        if (errMembre) throw errMembre;
        const liste = (membreRows || []).filter((m) => m.etablissements);
        setMesEtablissements(liste);
        setEtablissementActifId((prev) => prev && liste.some((m) => m.etablissement_id === prev)
          ? prev
          : liste[0]?.etablissement_id || null);
        setListeChargee(true);
      } catch (e) {
        console.error("Erreur chargement établissements:", e);
        setErreur("Impossible de charger vos établissements. Vérifiez votre connexion.");
        setListeChargee(true);
        setChargement(false);
      }
    })();
  }, [session]);

  // Charge les données de l'établissement actuellement sélectionné
  useEffect(() => {
    if (!listeChargee) return;
    if (!etablissementActifId) {
      setChargement(false);
      return;
    }
    const membreActif = mesEtablissements.find((m) => m.etablissement_id === etablissementActifId);
    setEtablissement(membreActif?.etablissements || null);
    setRole(membreActif?.role || null);

    (async () => {
      setChargement(true);
      const etab = membreActif?.etablissements;
      if (!etab) {
        setChargement(false);
        return;
      }
      // Chaque requête est isolée : si une table optionnelle échoue (ex. une
      // migration Supabase pas encore appliquée), les autres continuent de
      // se charger normalement au lieu de bloquer toute la page.
      const erreursRencontrees = [];

      try {
        const { data: tx, error: errTx } = await supabase
          .from("transactions")
          .select("*")
          .eq("etablissement_id", etab.id)
          .order("date", { ascending: false });
        if (errTx) throw errTx;
        setTransactions(tx || []);
      } catch (e) {
        console.error("Erreur chargement transactions:", e);
        erreursRencontrees.push("mouvements");
      }

      try {
        const { data: prod, error: errProd } = await supabase
          .from("produits")
          .select("*")
          .eq("etablissement_id", etab.id)
          .order("designation", { ascending: true });
        if (errProd) throw errProd;
        setProduits(prod || []);
      } catch (e) {
        console.error("Erreur chargement produits:", e);
        erreursRencontrees.push("stock");
      }

      try {
        const { data: fours, error: errFours } = await supabase
          .from("fournisseurs")
          .select("*")
          .eq("etablissement_id", etab.id)
          .order("nom", { ascending: true });
        if (errFours) throw errFours;
        setFournisseurs(fours || []);
      } catch (e) {
        console.error("Erreur chargement fournisseurs:", e);
        erreursRencontrees.push("fournisseurs");
      }

      try {
        const { count: countGerants, error: errGerants } = await supabase
          .from("membres")
          .select("id", { count: "exact", head: true })
          .eq("etablissement_id", etab.id)
          .eq("role", "gerant");
        if (errGerants) throw errGerants;
        setNombreGerants(countGerants || 0);
      } catch (e) {
        console.error("Erreur chargement gérants:", e);
      }

      try {
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
      } catch (e) {
        console.error("Erreur chargement caisse:", e);
        erreursRencontrees.push("caisse");
      }

      if (erreursRencontrees.length > 0) {
        setErreur(
          `Certaines données n'ont pas pu être chargées (${erreursRencontrees.join(", ")}). ` +
          `Vérifie que le script supabase-MASTER-COMPLET.sql a bien été exécuté dans Supabase.`
        );
      } else {
        setErreur(null);
      }
      setChargement(false);
    })();
  }, [etablissementActifId, mesEtablissements]);

  const changerEtablissement = (id) => {
    setEtablissementActifId(id);
  };

  const ajouterEtablissement = async (nom, secteur) => {
    if (!session) return false;
    const dejaProprietaire = mesEtablissements.some((m) => m.role === "proprietaire");
    const aLeForfaitEntreprise = mesEtablissements.some(
      (m) => m.role === "proprietaire" && m.etablissements?.plan === "entreprise"
    );
    if (dejaProprietaire && !aLeForfaitEntreprise) {
      setErreur(t("etab_forfait_requis"));
      return false;
    }
    try {
      // Correctif définitif : la création passe par la fonction RPC
      // `creer_etablissement` (SECURITY DEFINER), qui insère l'établissement
      // ET la ligne « membres » du propriétaire dans une seule transaction
      // en contournant la RLS. L'ancien parcours en deux INSERT échouait à
      // cause d'un contrôle RLS circulaire (bouton « sans réaction »).
      const { data: etab, error: errRpc } = await supabase.rpc("creer_etablissement", {
        nom,
        secteur,
      });
      if (errRpc) throw errRpc;

      const { data: membreRows } = await supabase
        .from("membres")
        .select("role, etablissement_id, etablissements(*)")
        .eq("user_id", session.user.id);
      setMesEtablissements((membreRows || []).filter((m) => m.etablissements));
      setEtablissementActifId(etab?.id);
      return true;
    } catch (e) {
      setErreur("Impossible de créer ce nouvel établissement.");
      return false;
    }
  };

  const addTransaction = async (donneesTx) => {
    if (!etablissement) return false;
    const { designation, quantite, ...champsTransaction } = donneesTx;
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
      await ajusterStock(designation.trim(), parseFloat(quantite) || 0, donneesTx.type);
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

  const addProduit = async (designation, quantite, prixUnitaire, seuilAlerte) => {
    const { data, error } = await supabase
      .from("produits")
      .insert({
        etablissement_id: etablissement.id,
        designation,
        quantite_stock: quantite,
        prix_unitaire: prixUnitaire || null,
        seuil_alerte: seuilAlerte || 5,
      })
      .select();
    if (error) {
      console.error("Erreur insertion produit:", error);
      setErreur(`Impossible d'ajouter ce produit au stock : ${error.message}`);
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

  const ajouterFournisseur = async (nom, telephone, note) => {
    const { data, error } = await supabase
      .from("fournisseurs")
      .insert({ etablissement_id: etablissement.id, nom, telephone, note: note || null })
      .select();
    if (error) {
      console.error("Erreur insertion fournisseur:", error);
      setErreur(`Impossible d'ajouter ce fournisseur : ${error.message}`);
      return false;
    }
    setFournisseurs([...fournisseurs, data[0]].sort((a, b) => a.nom.localeCompare(b.nom)));
    return true;
  };

  const supprimerFournisseur = async (id) => {
    const { error } = await supabase.from("fournisseurs").delete().eq("id", id);
    if (!error) setFournisseurs(fournisseurs.filter((f) => f.id !== id));
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

  const updateTransaction = async (id, champs) => {
    const { data, error } = await supabase.from("transactions").update(champs).eq("id", id).select();
    if (error) {
      setErreur("La modification a échoué.");
      return false;
    }
    setTransactions(transactions.map((t) => (t.id === id ? data[0] : t)));
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
    return <AuthScreen onAuthenticated={() => {}} langue={langue} setLangue={setLangue} t={t} />;
  }

  const essaiExpireLe = etablissement
    ? new Date(new Date(etablissement.date_creation).getTime() + (etablissement.essai_jours || 7) * 24 * 60 * 60 * 1000)
    : null;
  const essaiEnCours = essaiExpireLe ? maintenant < essaiExpireLe.getTime() : false;
  const accesAutorise = etablissement?.abonnement_actif || essaiEnCours;

  if (!chargement && etablissement && !accesAutorise) {
    return (
      <PaiementEnAttente
        etablissement={etablissement}
        essaiTermine={!essaiEnCours}
        onDeconnexion={() => { setSession(null); setEtablissement(null); }}
        onAbonnementActif={(etabMaj) => {
          setEtablissement((prev) => (prev ? { ...prev, ...etabMaj } : prev));
        }}
        langue={langue}
        setLangue={setLangue}
        t={t}
      />
    );
  }

  const msRestantEssai = essaiExpireLe ? essaiExpireLe.getTime() - maintenant : 0;
  const enEssai = !etablissement?.abonnement_actif && essaiEnCours;
  // Pendant l'essai gratuit, accès complet au niveau Starter (pas Pro) pour
  // permettre de tester l'outil avant de choisir un forfait.
  const planEffectif = enEssai ? "starter" : etablissement?.plan;

  return (
    <div style={{ ...styles.app, flexDirection: isMobile ? "column" : "row" }}>
      <style>{GLOBAL_CSS}</style>
      <Sidebar vue={vue} setVue={setVue} isMobile={isMobile} onLogout={seDeconnecter} t={t} />
      <div style={styles.main}>
        <TopBar
          etablissement={etablissement?.nom || "Mon établissement"}
          onRename={renameEtablissement}
          role={role}
          codeInvitation={etablissement?.code_invitation}
          plan={planEffectif}
          mesEtablissements={mesEtablissements}
          etablissementActifId={etablissementActifId}
          onChangerEtablissement={changerEtablissement}
          onAjouterEtablissement={ajouterEtablissement}
          nombreGerants={nombreGerants}
          langue={langue}
          setLangue={setLangue}
          t={t}
        />
        {enEssai && <EssaiBanner msRestant={msRestantEssai} estFondateur={etablissement?.est_fondateur} essaiJours={etablissement?.essai_jours} t={t} />}
        {erreur && <div style={styles.errorBanner}>{erreur}</div>}
        {!chargement && <PageBanner vue={vue} t={t} />}
        {chargement ? (
          <div style={styles.loading}>{t("chargement")}</div>
        ) : vue === "dashboard" ? (
          <Dashboard transactions={transactions} isMobile={isMobile} secteur={etablissement?.secteur} etablissement={etablissement} t={t} />
        ) : vue === "saisie" ? (
          <Saisie onAdd={addTransaction} secteur={etablissement?.secteur} etablissement={etablissement} t={t} />
        ) : vue === "stock" ? (
          <Stock
            produits={produits}
            onAdd={addProduit}
            onAjuster={ajusterQuantiteManuelle}
            onSupprimer={supprimerProduit}
            t={t}
          />
        ) : vue === "caisse" ? (
          <Caisse
            sessionCaisse={sessionCaisse}
            historiqueCaisse={historiqueCaisse}
            transactions={transactions}
            onOuvrir={ouvrirCaisse}
            onFermer={fermerCaisse}
            t={t}
          />
        ) : vue === "fournisseurs" ? (
          <Fournisseurs
            fournisseurs={fournisseurs}
            onAdd={ajouterFournisseur}
            onSupprimer={supprimerFournisseur}
            t={t}
          />
        ) : vue === "abonnement" ? (
          <Abonnement etablissement={etablissement} planEffectif={planEffectif} enEssai={enEssai} t={t} />
        ) : (
          <Historique transactions={transactions} onDelete={deleteTransaction} onUpdate={updateTransaction} plan={planEffectif} secteur={etablissement?.secteur} t={t} />
        )}
        <AppFooter />
      </div>
    </div>
  );
}


function AppFooter() {
  return <div style={styles.appFooter}>SHOPIN30 · 05 01 30 33 43</div>;
}

// Une photo professionnelle différente en tête de chaque page de l'app,
// pour un rendu plus soigné qu'un simple fond uni.
const PAGE_BANNERS = {
  dashboard: { src: "/images/promo-dashboard.png", position: "center 15%" },
  saisie: { src: "/images/photo-saisie.jpg", position: "center 30%" },
  caisse: { src: "/images/photo-boutique.jpg", position: "center 35%" },
  stock: { src: "/images/photo-marche.jpg", position: "center 30%" },
  historique: { src: "/images/photo-boutique.jpg", position: "center 20%" },
  fournisseurs: { src: "/images/photo-marche.jpg", position: "center 40%" },
  abonnement: { src: "/images/promo-controle.png", position: "center 10%" },
};

function PageBanner({ vue, t }) {
  const banner = PAGE_BANNERS[vue];
  if (!banner) return null;
  const label = t(`nav_${vue}`);
  return (
    <div className="page-banner" style={styles.pageBanner}>
      <img src={banner.src} alt={label} style={{ ...styles.pageBannerImg, objectPosition: banner.position }} />
      <div style={styles.pageBannerOverlay} />
      <div style={styles.pageBannerLabel}>{label}</div>
    </div>
  );
}

function Sidebar({ vue, setVue, isMobile, onLogout, t }) {
  const items = [
    { id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard },
    { id: "saisie", label: t("nav_saisie"), icon: PenLine },
    { id: "caisse", label: t("nav_caisse"), icon: Lock },
    { id: "stock", label: t("nav_stock"), icon: Package },
    { id: "historique", label: t("nav_historique"), icon: History },
    { id: "fournisseurs", label: t("nav_fournisseurs"), icon: Phone },
    { id: "abonnement", label: t("nav_abonnement"), icon: CreditCard },
  ];

  if (isMobile) {
    return (
      <aside style={styles.sidebarMobile}>
        <div style={styles.brandRowMobile}>
          <div style={styles.brand}>
            <div style={styles.brandMark}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M2 14L7 6L12 11L18 3" stroke="#E8B65A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={styles.brandName}>ComptaCi</div>
          </div>
          <button onClick={onLogout} style={styles.logoutBtnMobile}>
            <LogOut size={14} /> {t("nav_logout")}
          </button>
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
          <LogOut size={14} /> {t("nav_logout")}
        </button>
      </div>
    </aside>
  );
}

function EssaiBanner({ msRestant, estFondateur, essaiJours, t }) {
  const heures = Math.max(0, Math.floor(msRestant / (1000 * 60 * 60)));
  const jours = Math.floor(heures / 24);
  const heuresRestantes = heures % 24;
  const urgent = heures < 24;
  return (
    <div style={{ ...styles.essaiBanner, ...(urgent ? styles.essaiBannerUrgent : {}) }}>
      {estFondateur && <span style={styles.fondateurTag}>★ {t("fondateur_tag")}</span>}
      {urgent ? "⏰ " : ""}{t("essai_gratuit")} ({essaiJours || 7} {t("essai_jours")}) — {t("essai_reste")} {jours > 0 ? `${jours} j ${heuresRestantes} h` : `${heuresRestantes} h`} {t("essai_avant")} {estFondateur ? t("essai_fondateur") : t("essai_a_partir_de")}.
    </div>
  );
}

function TopBar({ etablissement, onRename, role, codeInvitation, plan, mesEtablissements, etablissementActifId, onChangerEtablissement, onAjouterEtablissement, nombreGerants, langue, setLangue, t }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(etablissement);
  const [inviteOuvert, setInviteOuvert] = useState(false);
  const [selecteurOuvert, setSelecteurOuvert] = useState(false);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouveauSecteur, setNouveauSecteur] = useState("restauration");
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [copie, setCopie] = useState(false);
  const estProprietaire = role === "proprietaire";
  const estPro = plan === "pro";
  const peutInviterGerant = estPro || (plan === "starter" && nombreGerants < 1);
  const plusieursEtablissements = mesEtablissements && mesEtablissements.length > 1;

  useEffect(() => setVal(etablissement), [etablissement]);

  const creerEtablissement = async () => {
    if (!nouveauNom.trim()) return;
    setAjoutEnCours(true);
    const succes = await onAjouterEtablissement(nouveauNom.trim(), nouveauSecteur);
    setAjoutEnCours(false);
    if (succes) {
      setNouveauNom("");
      setNouveauSecteur("restauration");
      setAjoutOuvert(false);
      setSelecteurOuvert(false);
    }
  };

  return (
    <header style={styles.topbar}>
      <div style={styles.topbarLeft}>
        <Building2 size={16} color="#8A8578" />
        {mesEtablissements && mesEtablissements.length > 0 ? (
          <div style={{ position: "relative" }}>
            <button style={styles.topbarNameBtn} onClick={() => setSelecteurOuvert((v) => !v)}>
              {etablissement}{role === "gerant" ? ` · ${t("nav_gerant")}` : ""}
              <ChevronDown size={14} color="#B5AF9E" />
            </button>
            {selecteurOuvert && (
              <div style={styles.etabPopover}>
                {mesEtablissements.map((m) => (
                  <button
                    key={m.etablissement_id}
                    onClick={() => { onChangerEtablissement(m.etablissement_id); setSelecteurOuvert(false); }}
                    style={{
                      ...styles.etabPopoverItem,
                      ...(m.etablissement_id === etablissementActifId ? styles.etabPopoverItemActive : {}),
                    }}
                  >
                    <span>{m.etablissements.nom}</span>
                    <span style={styles.etabPopoverRole}>{m.role === "proprietaire" ? t("etab_proprietaire") : t("etab_gerant")}</span>
                  </button>
                ))}
                <div style={styles.etabPopoverDivider} />
                {!ajoutOuvert ? (
                  <button style={styles.etabPopoverAdd} onClick={() => setAjoutOuvert(true)}>
                    {t("etab_ajouter")}
                  </button>
                ) : (
                  <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="text"
                      placeholder={t("etab_nom_placeholder")}
                      value={nouveauNom}
                      onChange={(e) => setNouveauNom(e.target.value)}
                      style={styles.etabPopoverInput}
                    />
                    <select value={nouveauSecteur} onChange={(e) => setNouveauSecteur(e.target.value)} style={styles.etabPopoverInput}>
                      {secteursTraduits(t).map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                    <button onClick={creerEtablissement} disabled={ajoutEnCours} style={styles.inviteCopyBtn}>
                      {ajoutEnCours ? t("etab_creation") : t("etab_creer")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : editing && estProprietaire ? (
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
          <span style={styles.topbarNameBtn}>{etablissement} · {t("nav_gerant")}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <LanguageSelector langue={langue} onChange={setLangue} />
        {estProprietaire && codeInvitation && peutInviterGerant && (
          <div style={{ position: "relative" }}>
            <button style={styles.inviteBtn} onClick={() => setInviteOuvert((v) => !v)}>
              {t("nav_invite_gerant")}
            </button>
            {inviteOuvert && (
              <div style={styles.invitePopover}>
                <div style={styles.invitePopoverLabel}>{t("auth_code_invitation")}</div>
                <div style={styles.inviteCode}>{codeInvitation}</div>
                <p style={styles.invitePopoverText}>
                  {t("invite_texte")}
                </p>
                <button
                  style={styles.inviteCopyBtn}
                  onClick={() => {
                    navigator.clipboard?.writeText(codeInvitation);
                    setCopie(true);
                    setTimeout(() => setCopie(false), 1500);
                  }}
                >
                  {copie ? t("invite_copie") : t("invite_copier")}
                </button>
              </div>
            )}
          </div>
        )}
        {estProprietaire && !peutInviterGerant && (
          <div style={styles.upgradeHint}>
            {plan === "starter" && nombreGerants >= 1 ? t("nav_limite_gerant_atteinte") : t("nav_plan_requis")}
          </div>
        )}
        <div style={styles.topbarDate}>
          {new Date().toLocaleDateString(langue === "ar" ? "ar-EG" : langue === "en" ? "en-US" : "fr-FR", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>
    </header>
  );
}

function Dashboard({ transactions, isMobile, secteur, etablissement, t }) {
  const stats = useMemo(() => computeStats(transactions), [transactions]);
  const [periode, setPeriode] = useState("mois");
  const [copie, setCopie] = useState(false);

  const trend = useMemo(() => buildTrend(transactions, periode), [transactions, periode]);
  const parCategorie = useMemo(() => buildCategorieBreakdown(transactions, secteur), [transactions, secteur]);

  const copierBilan = () => {
    const moisLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const texte = [
      `${t("dash_bilan_titre")} ${moisLabel} — ${etablissement?.nom || "Mon établissement"}`,
      ``,
      `${t("dash_ca")} : ${fmt(stats.caMois)} FCFA`,
      `${t("dash_depenses")} : ${fmt(stats.depMois)} FCFA`,
      `${t("dash_resultat")} : ${stats.resultatMois >= 0 ? "+" : ""}${fmt(stats.resultatMois)} FCFA`,
      `${t("dash_marge")} : ${stats.margeMois.toFixed(0)}%`,
      `${t("dash_tva")} : ${fmt(stats.tvaMois)} FCFA`,
      ``,
      t("dash_genere_via"),
    ].join("\n");
    navigator.clipboard?.writeText(texte);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  };

  return (
    <div style={styles.page}>
      <div style={styles.dashboardHeader}>
        <button onClick={copierBilan} style={styles.copyBtn}>
          <Copy size={14} /> {copie ? t("dash_bilan_copie") : t("dash_copier_bilan")}
        </button>
      </div>
      <div className="kpi-row">
        <KpiCard
          label={t("dash_ca")}
          value={stats.caMois}
          accent="gold"
          icon={<Wallet size={16} />}
          sub={`${stats.caMoisPct >= 0 ? "+" : ""}${stats.caMoisPct.toFixed(0)}% ${t("dash_vs_mois_dernier")}`}
        />
        <KpiCard
          label={t("dash_depenses")}
          value={stats.depMois}
          accent="clay"
          icon={<TrendingDown size={16} />}
          sub={`${stats.depMoisPct >= 0 ? "+" : ""}${stats.depMoisPct.toFixed(0)}% ${t("dash_vs_mois_dernier")}`}
        />
        <KpiCard
          label={t("dash_resultat")}
          value={stats.resultatMois}
          accent={stats.resultatMois >= 0 ? "teal" : "clay"}
          icon={stats.resultatMois >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          sub={`${t("dash_marge")} ${stats.margeMois.toFixed(0)}%`}
          hero
        />
        <KpiCard
          label={t("dash_tva")}
          value={stats.tvaMois}
          accent="ink"
          icon={<Wallet size={16} />}
          sub={t("dash_tva_note")}
        />
      </div>

      <div className="grid-two">
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>{t("dash_evolution")}</div>
              <div style={styles.cardCaption}>{t("dash_evolution_sous")}</div>
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
                <Area type="monotone" dataKey="ca" stroke="#D4A24C" strokeWidth={2} fill="url(#ca)" name={t("dash_ca")} />
                <Area type="monotone" dataKey="dep" stroke="#C1502E" strokeWidth={2} fill="url(#dep)" name={t("dash_depenses")} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>{t("dash_repartition")}</div>
              <div style={styles.cardCaption}>{t("dash_repartition_sous")}</div>
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
          <div style={styles.emptyTitle}>{t("dash_vide_titre")}</div>
          <div style={styles.emptyText}>{t("dash_vide_texte")}</div>
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

function Saisie({ onAdd, secteur, etablissement, t }) {
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
  const [dernierRecu, setDernierRecu] = useState(null);

  const totalCalcule = (parseFloat(quantite) || 0) * (parseFloat(prixUnitaire) || 0);

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!totalCalcule || totalCalcule <= 0) return;
    setErreurLocale("");
    setEnCours(true);
    const infosRecu = { type, designation: designation.trim(), quantite, prixUnitaire, total: totalCalcule, date };
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
      if (type === "vente") setDernierRecu(infosRecu);
      setDesignation("");
      setQuantite("1");
      setPrixUnitaire("");
      setConfirme(true);
      setTimeout(() => setConfirme(false), 1800);
    } else {
      setErreurLocale(t("saisie_erreur"));
    }
  };

  const texteRecu = (r) => [
    `${etablissement?.nom || "ComptaCi"}`,
    `${new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`,
    ``,
    r.designation || t("hist_vente"),
    `${t("saisie_quantite")} : ${r.quantite}`,
    `${t("saisie_prix_unitaire")} : ${fmt(parseFloat(r.prixUnitaire) || 0)} FCFA`,
    `${t("saisie_total")} : ${fmt(r.total)} FCFA`,
  ].join("\n");

  const partagerRecuWhatsapp = (r) => {
    const texte = encodeURIComponent(texteRecu(r));
    window.open(`https://wa.me/?text=${texte}`, "_blank");
  };

  const copierRecu = (r) => {
    navigator.clipboard?.writeText(texteRecu(r));
  };

  return (
    <div style={styles.page}>
      {dernierRecu && (
        <div style={styles.recuBox}>
          <div style={styles.recuBoxText}>{t("saisie_recu_question")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => partagerRecuWhatsapp(dernierRecu)} style={styles.recuBtn}>
              {t("saisie_recu_whatsapp")}
            </button>
            <button onClick={() => copierRecu(dernierRecu)} style={styles.recuBtnGhost}>
              <Copy size={13} /> {t("saisie_recu_copier")}
            </button>
            <button onClick={() => setDernierRecu(null)} style={styles.recuBtnGhost}>{t("saisie_recu_fermer")}</button>
          </div>
        </div>
      )}
      <div style={{ ...styles.card, maxWidth: 520, width: "100%" }}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("saisie_titre")}</div>
            <div style={styles.cardCaption}>{t("saisie_sous")}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={styles.toggleRow}>
            <button
              type="button"
              onClick={() => setType("vente")}
              style={{ ...styles.toggleBtn, ...(type === "vente" ? styles.toggleBtnActiveVente : {}) }}
            >
              {t("saisie_vente")}
            </button>
            <button
              type="button"
              onClick={() => setType("depense")}
              style={{ ...styles.toggleBtn, ...(type === "depense" ? styles.toggleBtnActiveDepense : {}) }}
            >
              {t("saisie_depense")}
            </button>
          </div>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>
              {type === "vente" ? t("saisie_designation_vente") : t("saisie_designation_depense")}
            </span>
            <input
              type="text"
              placeholder={type === "vente" ? t("saisie_designation_placeholder_vente") : t("saisie_designation_placeholder_depense")}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              style={styles.input}
            />
          </label>

          {type === "depense" && (
            <label style={styles.field}>
              <span style={styles.fieldLabel}>{t("saisie_categorie")}</span>
              <select value={categorie} onChange={(e) => setCategorie(e.target.value)} style={styles.select}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          )}

          <div style={styles.qtyRow}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>{t("saisie_quantite")}</span>
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
              <span style={styles.fieldLabel}>{t("saisie_prix_unitaire")}</span>
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
            <span style={styles.totalLabel}>{t("saisie_total")}</span>
            <span style={styles.totalValue}>{fmt(totalCalcule)} FCFA</span>
          </div>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t("saisie_date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
          </label>

          <button type="button" onClick={submit} disabled={enCours} style={styles.submitBtn}>
            <Plus size={16} /> {enCours ? t("saisie_enregistrement") : t("saisie_enregistrer")}
          </button>
          {confirme && <div style={styles.confirmMsg}>{t("saisie_confirme")}</div>}
          {erreurLocale && <div style={styles.erreurLocale}>{erreurLocale}</div>}
        </div>
      </div>
    </div>
  );
}

function Caisse({ sessionCaisse, historiqueCaisse, transactions, onOuvrir, onFermer, t }) {
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
            <div style={styles.cardTitle}>{t("caisse_titre")}</div>
            <div style={styles.cardCaption}>
              {sessionCaisse ? t("caisse_ouverte") : t("caisse_fermee")}
            </div>
          </div>
        </div>

        {!sessionCaisse ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>{t("caisse_fond_ouverture")}</span>
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
              <Unlock size={16} /> {enCours ? t("caisse_ouverture") : t("caisse_ouvrir")}
            </button>
          </div>
        ) : (
          <>
            <div style={styles.caisseSummary}>
              <div style={styles.caisseSummaryRow}>
                <span>{t("caisse_fond_depart")}</span>
                <strong>{fmt(sessionCaisse.fond_ouverture)} FCFA</strong>
              </div>
              <div style={styles.caisseSummaryRow}>
                <span>{t("caisse_ventes_depuis")}</span>
                <strong style={{ color: "#186B4E" }}>{fmt(ventesSession)} FCFA</strong>
              </div>
              <div style={styles.caisseSummaryRow}>
                <span>{t("caisse_depenses_depuis")}</span>
                <strong style={{ color: "#B4432A" }}>{fmt(depensesSession)} FCFA</strong>
              </div>
              <div style={{ ...styles.caisseSummaryRow, ...styles.caisseSummaryTotal }}>
                <span>{t("caisse_solde_attendu")}</span>
                <strong>{fmt(soldeAttendu)} FCFA</strong>
              </div>
            </div>

            {!modeFermeture ? (
              <button onClick={() => setModeFermeture(true)} style={{ ...styles.submitBtn, marginTop: 16 }}>
                <Lock size={16} /> {t("caisse_fermer")}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16, maxWidth: 360 }}>
                <label style={styles.field}>
                  <span style={styles.fieldLabel}>{t("caisse_montant_compte")}</span>
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
                    {t("caisse_ecart")} : {(parseFloat(fondCompte) - soldeAttendu) >= 0 ? "+" : ""}
                    {fmt(parseFloat(fondCompte) - soldeAttendu)} FCFA
                  </div>
                )}
                <button onClick={fermer} disabled={enCours} style={styles.submitBtn}>
                  {enCours ? t("caisse_fermeture") : t("caisse_confirmer_fermeture")}
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
              <div style={styles.cardTitle}>{t("caisse_historique_titre")}</div>
              <div style={styles.cardCaption}>{historiqueCaisse.length} {t("caisse_session_fermee")}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {historiqueCaisse.map((s) => (
              <div key={s.id} style={styles.txRow}>
                <div style={styles.txInfo}>
                  <div style={styles.txLabel}>
                    {new Date(s.date_ouverture).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  </div>
                  <div style={styles.txNote}>{t("caisse_fond_depart")} : {fmt(s.fond_ouverture)} FCFA · {t("caisse_compte")} : {fmt(s.fond_fermeture_reel)} FCFA</div>
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

function Stock({ produits, onAdd, onAjuster, onSupprimer, onSeuil, t }) {
  const [designation, setDesignation] = useState("");
  const [quantite, setQuantite] = useState("");
  const [prixUnitaire, setPrixUnitaire] = useState("");
  const [seuilAlerte, setSeuilAlerte] = useState("5");
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const submit = async () => {
    if (!designation.trim() || !quantite) return;
    setEnCours(true);
    const succes = await onAdd(designation.trim(), parseFloat(quantite) || 0, parseFloat(prixUnitaire) || null, parseFloat(seuilAlerte) || 5);
    setEnCours(false);
    if (succes) {
      setDesignation("");
      setQuantite("");
      setPrixUnitaire("");
      setSeuilAlerte("5");
      setOuvert(false);
    }
  };

  const produitsEnAlerte = produits.filter((p) => (parseFloat(p.quantite_stock) || 0) <= (parseFloat(p.seuil_alerte) || 5));

  return (
    <div style={styles.page}>
      {produitsEnAlerte.length > 0 && (
        <div style={styles.upgradeNotice}>
          ⚠️ {produitsEnAlerte.length} {t("stock_alerte")}{" "}
          {produitsEnAlerte.map((p) => p.designation).join(", ")}
        </div>
      )}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("stock_titre")}</div>
            <div style={styles.cardCaption}>
              {produits.length} — {t("stock_sous")}
            </div>
          </div>
          <button style={styles.inviteBtn} onClick={() => setOuvert((v) => !v)}>
            {ouvert ? t("stock_annuler") : t("stock_ajouter")}
          </button>
        </div>

        {ouvert && (
          <div style={styles.stockForm}>
            <input
              type="text"
              placeholder={t("stock_designation_placeholder")}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              style={{ ...styles.input, flex: "1 1 200px" }}
            />
            <input
              type="number"
              placeholder={t("stock_quantite_placeholder")}
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              style={{ ...styles.input, flex: "1 1 130px" }}
            />
            <input
              type="number"
              placeholder={t("stock_prix_placeholder")}
              value={prixUnitaire}
              onChange={(e) => setPrixUnitaire(e.target.value)}
              style={{ ...styles.input, flex: "1 1 150px" }}
            />
            <input
              type="number"
              placeholder={t("stock_seuil_placeholder")}
              value={seuilAlerte}
              onChange={(e) => setSeuilAlerte(e.target.value)}
              style={{ ...styles.input, flex: "1 1 150px" }}
            />
            <button onClick={submit} disabled={enCours} style={{ ...styles.submitBtn, flex: "1 1 100%" }}>
              {enCours ? t("stock_ajout_en_cours") : t("stock_ajout_btn")}
            </button>
          </div>
        )}

        {produits.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>{t("stock_vide_titre")}</div>
            <div style={styles.emptyText}>
              {t("stock_vide_texte")}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {produits.map((p) => {
              const enAlerte = (parseFloat(p.quantite_stock) || 0) <= (parseFloat(p.seuil_alerte) || 5);
              return (
              <div key={p.id} style={styles.stockRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.stockLabel}>{p.designation}</div>
                  {p.prix_unitaire && (
                    <div style={styles.stockSub}>{fmt(p.prix_unitaire)} {t("stock_unite")} — {t("stock_seuil_label")} : {fmt(p.seuil_alerte || 5)}</div>
                  )}
                </div>
                <button
                  onClick={() => onAjuster(p.id, (parseFloat(p.quantite_stock) || 0) - 1)}
                  style={styles.stockAdjustBtn}
                >
                  <Minus size={13} />
                </button>
                <div style={{ ...styles.stockQty, ...(enAlerte ? styles.stockQtyLow : {}) }}>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Abonnement({ etablissement, planEffectif, enEssai, t }) {
  const nomPlan = (p) =>
    p === "pro" ? t("paiement_plan_pro") : p === "entreprise" ? t("paiement_plan_entreprise") : t("paiement_plan_starter");

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("nav_abonnement")}</div>
            <div style={styles.cardCaption}>
              {enEssai
                ? t("abo_en_essai")
                : etablissement?.abonnement_actif
                  ? `${t("abo_plan_actuel")} : ${nomPlan(planEffectif)}`
                  : t("abo_paiement_titre")}
            </div>
          </div>
        </div>

        <p style={styles.aboIntro}>{t("abo_notice")}</p>

        <PaiementWave
          etablissement={etablissement}
          t={t}
          planInitial={planEffectif || "starter"}
          planActuel={etablissement?.abonnement_actif && !enEssai ? planEffectif : null}
          essaiEnCours={enEssai}
          compact
        />
      </div>
    </div>
  );
}

function Fournisseurs({ fournisseurs, onAdd, onSupprimer, t }) {
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [note, setNote] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const submit = async () => {
    if (!nom.trim() || !telephone.trim()) return;
    setEnCours(true);
    const succes = await onAdd(nom.trim(), telephone.trim(), note.trim());
    setEnCours(false);
    if (succes) {
      setNom("");
      setTelephone("");
      setNote("");
      setOuvert(false);
    }
  };

  const telephoneNettoye = (tel) => tel.replace(/\s|\+/g, "");

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("four_titre")}</div>
            <div style={styles.cardCaption}>{t("four_sous")}</div>
          </div>
          <button style={styles.inviteBtn} onClick={() => setOuvert((v) => !v)}>
            {ouvert ? t("stock_annuler") : t("four_ajouter")}
          </button>
        </div>

        {ouvert && (
          <div style={styles.stockForm}>
            <input
              type="text"
              placeholder={t("four_nom_placeholder")}
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              style={{ ...styles.input, flex: "1 1 200px" }}
            />
            <input
              type="tel"
              placeholder={t("four_telephone_placeholder")}
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              style={{ ...styles.input, flex: "1 1 160px" }}
            />
            <input
              type="text"
              placeholder={t("four_note_placeholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ ...styles.input, flex: "1 1 160px" }}
            />
            <button onClick={submit} disabled={enCours} style={{ ...styles.submitBtn, flex: "1 1 100%" }}>
              {t("four_ajout_btn")}
            </button>
          </div>
        )}

        {fournisseurs.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>{t("four_vide_titre")}</div>
            <div style={styles.emptyText}>{t("four_vide_texte")}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fournisseurs.map((f) => (
              <div key={f.id} style={styles.stockRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.stockLabel}>{f.nom}</div>
                  <div style={styles.stockSub}>{f.telephone}{f.note ? ` · ${f.note}` : ""}</div>
                </div>
                <a href={`tel:${telephoneNettoye(f.telephone)}`} style={styles.fourActionBtn} title={t("four_appeler")}>
                  <Phone size={14} />
                </a>
                <a
                  href={`https://wa.me/225${telephoneNettoye(f.telephone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.fourActionBtn}
                  title={t("four_whatsapp")}
                >
                  <MessageCircle size={14} />
                </a>
                <button onClick={() => onSupprimer(f.id)} style={styles.txDelete} aria-label="Supprimer">
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

function Historique({ transactions, onDelete, onUpdate, plan, secteur, t }) {
  const categories = categoriesDuSecteur(secteur);
  const limite30j = plan !== "pro";
  const seuil = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const transactionsVisibles = limite30j
    ? transactions.filter((tx) => new Date(tx.date).getTime() >= seuil)
    : transactions;
  const masquees = transactions.length - transactionsVisibles.length;
  const [enEdition, setEnEdition] = useState(null);
  const [montantEdit, setMontantEdit] = useState("");
  const [noteEdit, setNoteEdit] = useState("");

  const commencerEdition = (tx) => {
    setEnEdition(tx.id);
    setMontantEdit(String(tx.montant));
    setNoteEdit(tx.note || "");
  };

  const validerEdition = async (id) => {
    const m = parseFloat(montantEdit);
    if (!m || m <= 0) return;
    await onUpdate(id, { montant: m, note: noteEdit.trim() });
    setEnEdition(null);
  };

  const groups = useMemo(() => {
    const byDate = {};
    for (const tx of transactionsVisibles) {
      (byDate[tx.date] ||= []).push(tx);
    }
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [transactionsVisibles]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("hist_titre")}</div>
            <div style={styles.cardCaption}>
              {transactionsVisibles.length}
              {limite30j ? ` ${t("hist_30j")}` : ""} — {t("hist_sous")}
            </div>
          </div>
        </div>

        {limite30j && masquees > 0 && (
          <div style={styles.upgradeNotice}>
            {masquees} {t("hist_masques")}
          </div>
        )}

        {groups.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>{t("hist_vide_titre")}</div>
            <div style={styles.emptyText}>{t("hist_vide_texte")}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {groups.map(([date, items]) => (
              <div key={date}>
                <div style={styles.dateHeader}>
                  {new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((tx) =>
                    enEdition === tx.id ? (
                      <div key={tx.id} style={styles.txRowEdit}>
                        <input
                          type="number"
                          value={montantEdit}
                          onChange={(e) => setMontantEdit(e.target.value)}
                          style={styles.txEditInput}
                          autoFocus
                        />
                        <input
                          type="text"
                          value={noteEdit}
                          onChange={(e) => setNoteEdit(e.target.value)}
                          placeholder="Note"
                          style={{ ...styles.txEditInput, flex: 1 }}
                        />
                        <button onClick={() => validerEdition(tx.id)} style={styles.txSaveBtn}>{t("hist_valider")}</button>
                        <button onClick={() => setEnEdition(null)} style={styles.txCancelBtn}>{t("hist_annuler")}</button>
                      </div>
                    ) : (
                      <div key={tx.id} style={styles.txRow}>
                        <div style={{ ...styles.txDot, background: tx.type === "vente" ? "#186B4E" : "#B4432A" }} />
                        <div style={styles.txInfo}>
                          <div style={styles.txLabel}>
                            {tx.type === "vente" ? t("hist_vente") : categories.find((c) => c.id === tx.categorie)?.label || t("hist_depense")}
                          </div>
                          {tx.note && <div style={styles.txNote}>{tx.note}</div>}
                        </div>
                        <button
                          onClick={() => commencerEdition(tx)}
                          style={{ ...styles.txAmount, ...styles.txAmountBtn, color: tx.type === "vente" ? "#186B4E" : "#B4432A" }}
                        >
                          {tx.type === "vente" ? "+" : "-"}{fmt(tx.montant)}
                        </button>
                        <button onClick={() => onDelete(tx.id)} style={styles.txDelete} aria-label="Supprimer">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  )}
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

@media (max-width: 780px) {
  .page-banner { margin: 12px 16px 0 !important; height: 96px !important; }
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
  brandRowMobile: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  logoutBtnMobile: {
    display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#F3D9A0", fontSize: 12,
    fontWeight: 600, cursor: "pointer", padding: "7px 10px", fontFamily: "'Inter', sans-serif",
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
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, width: "100%", ...wallpaperStyle },
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
  etabPopover: {
    position: "absolute", top: "calc(100% + 8px)", left: 0, background: "#FFFEFB",
    border: "1px solid #EDE7DA", borderRadius: 12, padding: 8, width: 260,
    boxShadow: "0 8px 24px rgba(22,33,62,0.12)", zIndex: 20,
  },
  etabPopoverItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
    padding: "9px 10px", borderRadius: 8, border: "none", background: "transparent",
    fontSize: 13, color: "#16213E", cursor: "pointer", fontFamily: "'Inter', sans-serif", textAlign: "left",
  },
  etabPopoverItemActive: { background: "#FBF3E2", fontWeight: 600 },
  etabPopoverRole: { fontSize: 10.5, color: "#8A8578" },
  etabPopoverDivider: { height: 1, background: "#EDE7DA", margin: "6px 4px" },
  etabPopoverAdd: {
    width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "transparent",
    fontSize: 13, color: "#B4801F", fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif", textAlign: "left",
  },
  etabPopoverInput: {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #E4DDD0", fontSize: 12.5,
    fontFamily: "'Inter', sans-serif", color: "#16213E", outline: "none",
  },
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
  essaiBannerUrgent: { background: "#FBEBE4", color: "#B4432A", fontWeight: 700 },
  fondateurTag: {
    display: "inline-block", background: "#16213E", color: "#F3D9A0", fontSize: 10.5, fontWeight: 700,
    padding: "2px 8px", borderRadius: 20, marginRight: 8, letterSpacing: "0.02em",
  },
  pageBanner: {
    position: "relative", margin: "16px 32px 0", height: 130, borderRadius: 14,
    overflow: "hidden", flexShrink: 0,
  },
  pageBannerImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  pageBannerOverlay: {
    position: "absolute", inset: 0,
    background: "linear-gradient(90deg, rgba(22,33,62,0.72) 0%, rgba(22,33,62,0.28) 55%, rgba(22,33,62,0.05) 100%)",
  },
  pageBannerLabel: {
    position: "absolute", left: 20, bottom: 14, color: "#FBF7F0",
    fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em",
  },
  loading: { padding: 40, color: "#8A8578", fontSize: 14 },
  appFooter: { textAlign: "center", padding: "24px 20px 12px", fontSize: 11, color: "#B5AF9E" },
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
  fourActionBtn: {
    width: 30, height: 30, borderRadius: 8, border: "1px solid #E4DDD0", background: "#FFFEFB",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#186B4E",
    textDecoration: "none", flexShrink: 0,
  },
  aboIntro: {
    fontSize: 13, color: "#5C5748", lineHeight: 1.55, margin: "0 0 16px", maxWidth: 560,
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
  recuBox: {
    display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
    background: "#E4F2EC", border: "1px solid #B7DBCA", borderRadius: 10, padding: "12px 16px",
  },
  recuBoxText: { fontSize: 13, fontWeight: 600, color: "#186B4E" },
  recuBtn: {
    padding: "8px 14px", borderRadius: 8, border: "none", background: "#186B4E", color: "#FFFEFB",
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  recuBtnGhost: {
    display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
    border: "1px solid #B7DBCA", background: "transparent", color: "#186B4E", fontSize: 12.5,
    fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
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
  txAmountBtn: { background: "none", border: "none", cursor: "pointer", fontFamily: "'Fraunces', serif" },
  txDelete: { background: "none", border: "none", color: "#B5AF9E", cursor: "pointer", padding: 4 },
  txRowEdit: {
    display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 9, background: "#FBF3E2",
  },
  txEditInput: {
    padding: "6px 8px", borderRadius: 7, border: "1px solid #E4DDD0", fontSize: 13,
    fontFamily: "'Inter', sans-serif", color: "#16213E", outline: "none", width: 100,
  },
  txSaveBtn: {
    padding: "6px 12px", borderRadius: 7, border: "none", background: "#16213E", color: "#F3D9A0",
    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  txCancelBtn: {
    padding: "6px 12px", borderRadius: 7, border: "1px solid #E4DDD0", background: "transparent", color: "#8A8578",
    fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
};
