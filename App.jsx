import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Plus, TrendingUp, TrendingDown, Wallet, LayoutDashboard, PenLine, History, Trash2, Building2, ChevronDown, LogOut, Package, Copy, Minus, Lock, Unlock, Phone, MessageCircle, CreditCard, Store, Info } from "lucide-react";
import { supabase, configManquante, clientEnErreur } from "./supabaseClient.js";
import AuthScreen from "./AuthScreen.jsx";
import PaiementEnAttente from "./PaiementEnAttente.jsx";
import LanguageSelector from "./LanguageSelector.jsx";
import { traducteur, getLangueInitiale, sauvegarderLangue, RTL_LANGUES } from "./i18n.js";
import PaiementWave, { PRIX_PLANS } from "./PaiementWave.jsx";
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

/**
 * Nature de chaque poste de dépense : achats/approvisionnements, masse
 * salariale, charges de structure ou autre. Sert aux ratios du tableau de bord.
 */
const POSTES_PAR_CATEGORIE = {
  medicaments: "achats",
  parapharmacie: "achats",
  materiel_medical: "achats",
  alimentaire: "achats",
  hygiene: "achats",
  boissons: "achats",
  emballages: "achats",
  materiaux: "achats",
  outillage: "achats",
  plomberie: "achats",
  electricite: "achats",
  peinture: "achats",
  nourriture: "achats",
  personnel: "personnel",
  charges_fixes: "charges",
  autre: "autre",
};

/** Seuils de bonne gestion (en % du CA) propres à chaque secteur. */
const SEUILS_RATIOS = {
  pharmacie: { achats: 65, personnel: 15, charges: 15 },
  boutique: { achats: 75, personnel: 12, charges: 12 },
  quincaillerie: { achats: 70, personnel: 12, charges: 15 },
  restauration: { achats: 40, personnel: 20, charges: 15 },
};

/** Objectif de marge brute indicative, par secteur. */
const MARGE_CIBLE = {
  pharmacie: "25 – 35 %",
  boutique: "15 – 25 %",
  quincaillerie: "20 – 30 %",
  restauration: "55 – 65 %",
};

/** Montants usuels proposés en un clic à l'ouverture de la caisse. */
const MONTANTS_RAPIDES_CAISSE = [5000, 10000, 20000, 50000, 100000];

/** Palette des barres de répartition (dépenses par poste sectoriel). */
const COULEURS_REPARTITION = [
  "#16213E",
  "#D4A24C",
  "#C1502E",
  "#186B4E",
  "#6B5B95",
  "#2E7BA6",
  "#8A8578",
  "#B4801F",
];

/** Valeur d'une ligne de stock : quantité disponible × prix unitaire. */
const valeurStockLigne = (p) =>
  (parseFloat(p.quantite_stock) || 0) * (parseFloat(p.prix_unitaire) || 0);

/** Quantité d'une transaction (colonne dédiée, sinon relue dans la note). */
function quantiteTransaction(tx) {
  const directe = parseFloat(tx.quantite);
  if (!isNaN(directe) && directe > 0) return directe;
  const trouve = /Qté\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i.exec(tx.note || "");
  return trouve ? parseFloat(trouve[1].replace(",", ".")) || 0 : 0;
}

/** Désignation d'une transaction (colonnes récentes, sinon début de la note). */
function designationTransaction(tx) {
  if (tx.designation && String(tx.designation).trim()) return String(tx.designation).trim();
  const note = (tx.note || "").trim();
  if (!note) return "";
  const premiere = note.split("—")[0].trim();
  return /^Qté/i.test(premiere) ? "" : premiere;
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
  const [modeRecuperation, setModeRecuperation] = useState(false);
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      // L'utilisateur a cliqué sur le lien « réinitialiser le mot de passe »
      // reçu par email : on affiche l'écran de choix d'un nouveau mot de passe.
      if (event === "PASSWORD_RECOVERY") {
        setModeRecuperation(true);
      }
      setSession(s);
      if (!s) {
        setMesEtablissements([]);
        setEtablissementActifId(null);
        setEtablissement(null);
        setRole(null);
        setTransactions([]);
        setProduits([]);
        setFournisseurs([]);
        setListeChargee(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Charge la liste de tous les établissements accessibles à ce compte
  const chargerEtablissements = async (prefereId = null) => {
    const { data: { session: s } } = await supabase.auth.getSession();
    const sessionActive = s || session;
    const uId = sessionActive?.user?.id;
    if (!uId) {
      setChargement(false);
      return;
    }
    setChargement(true);
    try {
      const { data: membreRows, error: errMembre } = await supabase
        .from("membres")
        .select("role, etablissement_id, etablissements(*)")
        .eq("user_id", uId);
      if (errMembre) throw errMembre;
      const liste = (membreRows || []).filter((m) => m.etablissements);
      setMesEtablissements(liste);
      setEtablissementActifId((prev) => {
        const cible = prefereId || prev;
        return cible && liste.some((m) => m.etablissement_id === cible)
          ? cible
          : liste[0]?.etablissement_id || null;
      });
      setListeChargee(true);
    } catch (e) {
      console.error("Erreur chargement établissements:", e);
      setErreur("Impossible de charger vos établissements. Vérifiez votre connexion.");
      setListeChargee(true);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    chargerEtablissements();
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

      await chargerEtablissements(etab?.id);
      return true;
    } catch (e) {
      setErreur("Impossible de créer ce nouvel établissement.");
      return false;
    }
  };

  const addTransaction = async (donneesTx) => {
    if (!etablissement) return false;
    const { designation, quantite, prixUnitaire, ...champsTransaction } = donneesTx;
    const quantiteNumerique = parseFloat(quantite) || 0;
    const prixNumerique = parseFloat(prixUnitaire) || 0;
    const champsCommuns = { ...champsTransaction, etablissement_id: etablissement.id };

    // La colonne `quantite` n'existe que si la migration
    // supabase-transactions-quantite.sql a été appliquée. On tente d'abord avec,
    // puis on retente sans elle : un simple oubli de migration ne doit jamais
    // empêcher l'enregistrement d'une vente.
    let { data, error } = await supabase
      .from("transactions")
      .insert({ ...champsCommuns, quantite: quantiteNumerique })
      .select();
    if (error && /quantite/i.test(error.message || "")) {
      const repli = await supabase.from("transactions").insert(champsCommuns).select();
      data = repli.data;
      error = repli.error;
    }
    if (error) {
      console.error("Erreur insertion transaction:", error);
      setErreur(`L'enregistrement a échoué : ${error.message}`);
      return false;
    }
    // On garde la quantité et la désignation en mémoire même si la base ne les
    // stocke pas encore : le tableau de bord peut ainsi valoriser la vente tout
    // de suite (elles sont relues dans la note après rechargement).
    const transactionCreee = {
      ...(data?.[0] || {}),
      quantite: quantiteNumerique,
      designation: designation ? designation.trim() : "",
    };
    setTransactions([transactionCreee, ...transactions]);

    if (designation && designation.trim() && quantiteNumerique > 0) {
      await ajusterStock(designation.trim(), quantiteNumerique, donneesTx.type, prixNumerique);
    }
    return true;
  };

  const ajusterStock = async (designation, quantite, type, prixUnitaire = 0) => {
    const existant = produits.find(
      (p) => p.designation.toLowerCase() === designation.toLowerCase()
    );
    const variation = type === "vente" ? -quantite : quantite;

    if (existant) {
      const nouvelleQuantite = (parseFloat(existant.quantite_stock) || 0) + variation;
      const miseAJour = { quantite_stock: nouvelleQuantite, maj_le: new Date().toISOString() };
      // Valorisation : si le produit n'a pas encore de prix unitaire et que la
      // vente (ou l'achat) en indique un, on l'enregistre : la valeur en FCFA
      // de la ligne de stock peut alors être calculée immédiatement.
      const prixActuel = parseFloat(existant.prix_unitaire) || 0;
      if (!prixActuel && prixUnitaire > 0) miseAJour.prix_unitaire = prixUnitaire;

      const { data, error } = await supabase
        .from("produits")
        .update(miseAJour)
        .eq("id", existant.id)
        .select();
      if (!error && data?.[0]) {
        setProduits((liste) => liste.map((p) => (p.id === existant.id ? data[0] : p)));
      }
    } else if (type === "depense") {
      // Une dépense sur un produit inconnu : on le crée automatiquement en stock
      const { data, error } = await supabase
        .from("produits")
        .insert({
          etablissement_id: etablissement.id,
          designation,
          quantite_stock: quantite,
          prix_unitaire: prixUnitaire > 0 ? prixUnitaire : null,
        })
        .select();
      if (!error && data?.[0]) {
        setProduits((liste) => [...liste, data[0]]);
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
    setProduits((liste) => [...liste, data[0]]);
    return true;
  };

  const ajusterQuantiteManuelle = async (id, nouvelleQuantite) => {
    const { data, error } = await supabase
      .from("produits")
      .update({ quantite_stock: nouvelleQuantite, maj_le: new Date().toISOString() })
      .eq("id", id)
      .select();
    if (!error && data?.[0]) {
      setProduits((liste) => liste.map((p) => (p.id === id ? data[0] : p)));
    }
  };

  const modifierSeuil = async (id, seuil) => {
    const { data, error } = await supabase
      .from("produits")
      .update({ seuil_alerte: seuil, maj_le: new Date().toISOString() })
      .eq("id", id)
      .select();
    if (!error && data?.[0]) {
      setProduits((liste) => liste.map((p) => (p.id === id ? data[0] : p)));
    }
  };

  const supprimerProduit = async (id) => {
    const { error } = await supabase.from("produits").delete().eq("id", id);
    if (!error) setProduits((liste) => liste.filter((p) => p.id !== id));
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
    // On fusionne avec la ligne précédente : la quantité et la désignation
    // peuvent n'exister qu'en mémoire (base non encore migrée).
    setTransactions((liste) => liste.map((t) => (t.id === id ? { ...t, ...data[0] } : t)));
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
    setRole(null);
    setMesEtablissements([]);
    setEtablissementActifId(null);
    setListeChargee(false);
  };

  // Supprime le compte de l'utilisateur connecté (auth.users + données).
  // Passe par la RPC `supprimer_mon_compte` (SECURITY DEFINER) : la
  // suppression d'un compte est impossible avec la clé anon du navigateur.
  const supprimerMonCompte = async () => {
    try {
      const { error } = await supabase.rpc("supprimer_mon_compte");
      if (error) throw error;
      try { await supabase.auth.signOut(); } catch (e) { /* déjà supprimé */ }
      setSession(null);
      setEtablissement(null);
      setMesEtablissements([]);
      setEtablissementActifId(null);
      setTransactions([]);
      setProduits([]);
      setFournisseurs([]);
      return true;
    } catch (e) {
      console.error("Erreur suppression du compte :", e);
      return false;
    }
  };

  if (verifSession) {
    return <div style={styles.loading}>Chargement…</div>;
  }

  if (modeRecuperation) {
    return (
      <RecuperationMotDePasse
        t={t}
        onTermine={() => setModeRecuperation(false)}
      />
    );
  }

  if (!session) {
    return (
      <AuthScreen
        onAuthenticated={(etabId) => chargerEtablissements(etabId)}
        langue={langue}
        setLangue={setLangue}
        t={t}
      />
    );
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
            onSeuil={modifierSeuil}
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
          <Abonnement
            etablissement={etablissement}
            planEffectif={planEffectif}
            enEssai={enEssai}
            onSupprimerCompte={supprimerMonCompte}
            t={t}
          />
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
  // Même clé de mois que computeStats (heure locale, pas UTC) pour que le
  // classement des produits corresponde exactement au CA affiché.
  const maintenant = new Date();
  const cleMois = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}`;
  const topProduits = useMemo(() => buildTopProduits(transactions, cleMois), [transactions, cleMois]);

  const secteurActif = SECTEURS_IDS.includes(secteur) ? secteur : "restauration";
  const libelleSecteur = t(`secteur_${secteurActif}`);
  const seuils = SEUILS_RATIOS[secteurActif] || SEUILS_RATIOS.restauration;

  const totalDepenses = parCategorie.reduce((a, c) => a + c.value, 0);
  const ratios = [
    { cle: "achats", label: t("dash_poids_achats"), montant: stats.postes.achats, seuil: seuils.achats, couleur: "#C1502E" },
    { cle: "personnel", label: t("dash_poids_personnel"), montant: stats.postes.personnel, seuil: seuils.personnel, couleur: "#D4A24C" },
    { cle: "charges", label: t("dash_poids_charges"), montant: stats.postes.charges, seuil: seuils.charges, couleur: "#6B5B95" },
  ].map((r) => ({ ...r, ...evaluerRatio(r.montant, stats.caMois, r.seuil) }));

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
      <div style={{ ...styles.dashboardHeader, justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={styles.secteurBadge}>
          <Store size={13} />
          <span>
            {t("dash_secteur")} : <strong>{libelleSecteur}</strong>
          </span>
        </div>
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

      <div className="kpi-row-3">
        <KpiCard
          label={t("dash_panier_moyen")}
          value={stats.panierMoyen}
          accent="gold"
          icon={<Wallet size={16} />}
          sub={t("dash_panier_moyen_sous")}
        />
        <KpiCard
          label={t("dash_nb_ventes")}
          valeurTexte={fmt(stats.nbVentes)}
          value={stats.nbVentes}
          unite=""
          accent="teal"
          icon={<TrendingUp size={16} />}
          sub={t("dash_secteur") + " : " + libelleSecteur}
        />
        <KpiCard
          label={t("dash_nb_depenses")}
          valeurTexte={fmt(stats.nbDepenses)}
          value={stats.nbDepenses}
          unite=""
          accent="clay"
          icon={<TrendingDown size={16} />}
          sub={t("dash_total_depenses") + " : " + fmt(stats.depMois) + " FCFA"}
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

      {/* Répartition détaillée des dépenses par poste sectoriel */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>{t("dash_depenses_detail_titre")}</div>
            <div style={styles.cardCaption}>
              {t("dash_depenses_detail_sous")} — {libelleSecteur}
            </div>
          </div>
          <div style={styles.cardMontant}>{fmt(totalDepenses)} <span style={styles.kpiUnit}>FCFA</span></div>
        </div>
        {totalDepenses > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {parCategorie
              .filter((c) => c.value > 0)
              .map((c, i) => {
                const part = (c.value / totalDepenses) * 100;
                return (
                  <div key={c.id}>
                    <div style={styles.repartitionHead}>
                      <span style={styles.repartitionLabel}>{c.label}</span>
                      <span style={styles.repartitionMontant}>
                        {fmt(c.value)} FCFA · {part.toFixed(0)}%
                      </span>
                    </div>
                    <BarreProgression pourcentage={part} couleur={COULEURS_REPARTITION[i % COULEURS_REPARTITION.length]} />
                  </div>
                );
              })}
          </div>
        ) : (
          <div style={styles.emptyText}>{t("dash_aucune_depense")}</div>
        )}
      </div>

      <div className="grid-two">
        {/* Classement des produits vendus ce mois-ci */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>{t("dash_top_produits")}</div>
              <div style={styles.cardCaption}>{t("dash_top_produits_sous")}</div>
            </div>
          </div>
          {topProduits.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {topProduits.map((p, i) => (
                <div key={p.designation}>
                  <div style={styles.repartitionHead}>
                    <span style={styles.repartitionLabel}>
                      {i + 1}. {p.designation}
                    </span>
                    <span style={styles.repartitionMontant}>
                      {fmt(p.ca)} FCFA · {p.part.toFixed(0)}%
                    </span>
                  </div>
                  <BarreProgression pourcentage={p.part} couleur="#D4A24C" />
                  <div style={styles.repartitionDetail}>
                    {t("dash_col_qte")} : {fmt(p.quantite)} — {fmt(p.nbVentes)} {t("dash_ventes_court")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyText}>{t("dash_top_vide")}</div>
          )}
        </div>

        {/* Ratios financiers : poids de chaque poste par rapport au CA */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>{t("dash_ratios_titre")}</div>
              <div style={styles.cardCaption}>{t("dash_ratios_sous")}</div>
            </div>
          </div>
          {stats.caMois > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {ratios.map((r) => (
                <div key={r.cle}>
                  <div style={styles.repartitionHead}>
                    <span style={styles.repartitionLabel}>{r.label}</span>
                    <span style={styles.repartitionMontant}>
                      {r.poids.toFixed(0)}% {t("dash_du_ca")}
                    </span>
                  </div>
                  <BarreProgression
                    pourcentage={(r.poids / (r.seuil * 1.5)) * 100}
                    couleur={r.couleur}
                  />
                  <div style={styles.repartitionDetail}>
                    <span
                      style={{
                        ...styles.ratioBadge,
                        ...(r.niveau === "sain"
                          ? styles.ratioSain
                          : r.niveau === "surveiller"
                          ? styles.ratioSurveiller
                          : r.niveau === "alerte"
                          ? styles.ratioAlerte
                          : {}),
                      }}
                    >
                      {r.niveau === "sain"
                        ? t("dash_ratio_sain")
                        : r.niveau === "surveiller"
                        ? t("dash_ratio_surveiller")
                        : r.niveau === "alerte"
                        ? t("dash_ratio_alerte")
                        : t("stock_valeur_indispo")}
                    </span>{" "}
                    {t("dash_cible_max", { seuil: r.seuil })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyText}>{t("dash_ratios_vide")}</div>
          )}
        </div>
      </div>

      {/* Repères & Conseils de gestion sectoriels */}
      <div style={styles.conseilsCard}>
        <div style={styles.conseilsHeader}>
          <span style={styles.conseilsIcon}>
            <Info size={15} />
          </span>
          <div>
            <div style={styles.cardTitle}>{t("dash_reperes_titre")}</div>
            <div style={styles.cardCaption}>{t("dash_reperes_sous", { secteur: libelleSecteur })}</div>
          </div>
        </div>
        <div style={styles.conseilsMarge}>
          <span>{t("dash_marge_cible")}</span>
          <strong>{MARGE_CIBLE[secteurActif] || "—"}</strong>
        </div>
        <ul style={styles.conseilsListe}>
          {[1, 2, 3].map((n) => (
            <li key={n} style={styles.conseilItem}>
              {t(`dash_conseil_${secteurActif}_${n}`)}
            </li>
          ))}
        </ul>
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

function KpiCard({ label, value, accent, icon, sub, hero, valeurTexte, unite = "FCFA" }) {
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
        {valeurTexte !== undefined ? (
          valeurTexte
        ) : (
          <>
            {value < 0 ? "-" : ""}
            {fmt(Math.abs(value))}
          </>
        )}
        {unite ? <span style={styles.kpiUnit}> {unite}</span> : null}
      </div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

/** Barre de progression utilisée par les répartitions du tableau de bord. */
function BarreProgression({ pourcentage, couleur = "#16213E", fond = "#F1ECE2" }) {
  const largeur = Math.max(0, Math.min(100, pourcentage || 0));
  return (
    <div style={{ ...styles.barTrack, background: fond }}>
      <div style={{ ...styles.barFill, width: `${largeur}%`, background: couleur }} />
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
  const [guideOuvert, setGuideOuvert] = useState(true);

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

        {/* Guide pédagogique : qu'est-ce que le fond de caisse et comment
            ComptaCi calcule la clôture. Masquable une fois le principe acquis. */}
        <div style={styles.guideCard}>
          <button
            onClick={() => setGuideOuvert((v) => !v)}
            style={styles.guideToggle}
            aria-expanded={guideOuvert}
          >
            <Info size={14} />
            <span>{t("caisse_guide_titre")}</span>
            <ChevronDown
              size={15}
              style={{
                marginLeft: "auto",
                transition: "transform 0.2s",
                transform: guideOuvert ? "rotate(180deg)" : "none",
              }}
            />
          </button>

          {guideOuvert && (
            <div style={styles.guideBody}>
              <p style={styles.guideTexte}>{t("caisse_guide_def")}</p>

              <div style={styles.guideFormule}>
                <div style={styles.guideFormuleTitre}>{t("caisse_guide_formule_titre")}</div>
                <div style={styles.guideFormuleLigne}>{t("caisse_guide_formule")}</div>
                <div style={styles.guideFormuleNote}>{t("caisse_guide_formule_note")}</div>
              </div>

              <div style={styles.guideEtapesTitre}>{t("caisse_etapes_titre")}</div>
              <ol style={styles.guideEtapes}>
                {[1, 2, 3, 4].map((n) => (
                  <li key={n} style={styles.guideEtape}>
                    <span style={styles.guideEtapeNumero}>{n}</span>
                    <div>
                      <div style={styles.guideEtapeTitre}>{t(`caisse_etape${n}_titre`)}</div>
                      <div style={styles.guideEtapeTexte}>{t(`caisse_etape${n}_texte`)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {!sessionCaisse ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
            <div style={styles.caisseConsigne}>{t("caisse_entrez_fond")}</div>
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
            <div style={styles.montantsRapides}>
              <span style={styles.montantsRapidesLabel}>{t("caisse_montants_rapides")}</span>
              <div style={styles.montantsRapidesRow}>
                {MONTANTS_RAPIDES_CAISSE.map((montant) => (
                  <button
                    key={montant}
                    type="button"
                    onClick={() => setFondOuverture(String(montant))}
                    style={{
                      ...styles.montantRapideBtn,
                      ...(parseFloat(fondOuverture) === montant ? styles.montantRapideBtnActif : {}),
                    }}
                  >
                    {fmt(montant)}
                  </button>
                ))}
              </div>
            </div>
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

  const quantiteSaisie = parseFloat(quantite) || 0;
  const prixSaisi = parseFloat(prixUnitaire) || 0;
  const valeurLotApercu = quantiteSaisie * prixSaisi;

  // Valorisation en temps réel : quantité disponible × prix unitaire.
  // Tout est recalculé à chaque changement de `produits`, donc dès qu'une
  // vente est enregistrée dans « Saisie du jour », la valeur redescend.
  const valeurTotaleStock = produits.reduce((a, p) => a + valeurStockLigne(p), 0);
  const unitesTotales = produits.reduce((a, p) => a + (parseFloat(p.quantite_stock) || 0), 0);
  const produitsEnAlerte = produits.filter((p) => (parseFloat(p.quantite_stock) || 0) <= (parseFloat(p.seuil_alerte) || 5));

  return (
    <div style={styles.page}>
      <div className="kpi-row">
        <KpiCard
          label={t("stock_valeur_totale")}
          value={valeurTotaleStock}
          accent="gold"
          icon={<Package size={16} />}
          sub={t("stock_valeur_totale_sous")}
          hero
        />
        <KpiCard
          label={t("stock_references")}
          valeurTexte={fmt(produits.length)}
          value={produits.length}
          unite=""
          accent="ink"
          icon={<Package size={16} />}
          sub={t("stock_references_sous")}
        />
        <KpiCard
          label={t("stock_unites_totales")}
          valeurTexte={fmt(unitesTotales)}
          value={unitesTotales}
          unite=""
          accent="teal"
          icon={<Package size={16} />}
          sub={t("stock_maj_auto")}
        />
        <KpiCard
          label={t("stock_articles_alerte")}
          valeurTexte={fmt(produitsEnAlerte.length)}
          value={produitsEnAlerte.length}
          unite=""
          accent={produitsEnAlerte.length > 0 ? "clay" : "ink"}
          icon={<Package size={16} />}
          sub={t("stock_seuil_label")}
        />
      </div>

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
            {/* Aperçu en direct de la valeur du lot pendant la saisie */}
            <div style={styles.stockApercu}>
              <div style={styles.stockApercuTitre}>{t("stock_apercu_titre")}</div>
              {valeurLotApercu > 0 ? (
                <>
                  <div style={styles.stockApercuValeur}>{fmt(valeurLotApercu)} FCFA</div>
                  <div style={styles.stockApercuDetail}>
                    {t("stock_apercu_calcul", {
                      qte: fmt(quantiteSaisie),
                      pu: fmt(prixSaisi),
                      total: fmt(valeurLotApercu),
                    })}
                  </div>
                </>
              ) : (
                <div style={styles.stockApercuDetail}>{t("stock_apercu_sans_prix")}</div>
              )}
            </div>
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
              const quantiteProduit = parseFloat(p.quantite_stock) || 0;
              const prixProduit = parseFloat(p.prix_unitaire) || 0;
              const valeurProduit = valeurStockLigne(p);
              return (
              <div key={p.id} style={styles.stockRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.stockLabel}>{p.designation}</div>
                  <div style={styles.stockSub}>
                    {prixProduit > 0
                      ? `${fmt(prixProduit)} ${t("stock_unite")}`
                      : t("stock_prix_manquant")}
                  </div>
                </div>

                {/* Valeur en FCFA de la ligne : quantité disponible × prix unitaire */}
                <div style={styles.stockValeur}>
                  <div style={styles.stockValeurMontant}>
                    {prixProduit > 0 ? `${fmt(valeurProduit)} FCFA` : t("stock_valeur_indispo")}
                  </div>
                  <div style={styles.stockValeurDetail}>
                    {prixProduit > 0 ? `${fmt(quantiteProduit)} × ${fmt(prixProduit)}` : ""}
                  </div>
                </div>

                <label style={styles.stockSeuilField} title={t("stock_seuil_label")}>
                  <span style={styles.stockSeuilLabel}>{t("stock_seuil_label")}</span>
                  <input
                    type="number"
                    min="0"
                    value={p.seuil_alerte ?? 5}
                    onChange={(e) => onSeuil && onSeuil(p.id, parseFloat(e.target.value) || 0)}
                    style={styles.stockSeuilInput}
                    aria-label={t("stock_seuil_label")}
                  />
                </label>

                <button
                  onClick={() => onAjuster(p.id, quantiteProduit - 1)}
                  style={styles.stockAdjustBtn}
                  aria-label="-1"
                >
                  <Minus size={13} />
                </button>
                <div style={{ ...styles.stockQty, ...(enAlerte ? styles.stockQtyLow : {}) }}>
                  {fmt(p.quantite_stock)}
                </div>
                <button
                  onClick={() => onAjuster(p.id, quantiteProduit + 1)}
                  style={styles.stockAdjustBtn}
                  aria-label="+1"
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

/**
 * Les 9 caractéristiques comparées, sans doublon.
 * Chaque ligne indique si la caractéristique est incluse dans le forfait.
 */
export const LIGNES_COMPARATIF = [
  { cle: "abo_feat_1etab", starter: true, pro: true, entreprise: false },
  { cle: "abo_feat_multi", starter: false, pro: false, entreprise: true },
  { cle: "abo_feat_saisie", starter: true, pro: true, entreprise: true },
  { cle: "abo_feat_dashboard", starter: true, pro: true, entreprise: true },
  { cle: "abo_feat_hist30", starter: true, pro: false, entreprise: false },
  { cle: "abo_feat_histcomplet", starter: false, pro: true, entreprise: true },
  { cle: "abo_feat_tva", starter: true, pro: true, entreprise: true },
  { cle: "abo_feat_gerant1", starter: true, pro: false, entreprise: false },
  { cle: "abo_feat_gerantillim", starter: false, pro: true, entreprise: true },
];

const formatterFCFA = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Cellule ✅ / — du tableau comparatif. */
function CelluleComparatif({ inclus }) {
  return (
    <div style={styles.comparatifCell}>
      <span aria-hidden="true" style={styles.comparatifCheck}>
        {inclus ? "✅" : "—"}
      </span>
    </div>
  );
}

/** Carte « Comparer les forfaits » : 9 caractéristiques × 3 forfaits. */
function ComparatifForfaits({ t }) {
  const plans = ["starter", "pro", "entreprise"];
  const nomPlan = (p) =>
    p === "pro" ? t("paiement_plan_pro") : p === "entreprise" ? t("paiement_plan_entreprise") : t("paiement_plan_starter");

  return (
    <div style={styles.comparatifCard}>
      <div style={styles.comparatifTitre}>{t("abo_comparatif_titre")}</div>
      <div style={styles.comparatifTable} role="table">
        <div className="comparatif-row" style={styles.comparatifHead} role="row">
          <div style={styles.comparatifLabelHead} role="columnheader">
            {t("abo_comparatif_colonne")}
          </div>
          {plans.map((p) => (
            <div key={p} style={styles.comparatifColHead} role="columnheader">
              <span style={styles.comparatifColNom}>{nomPlan(p)}</span>
              <span style={styles.comparatifColPrix}>
                {formatterFCFA(PRIX_PLANS[p])} FCFA{t("plan_par_mois_court")}
              </span>
            </div>
          ))}
        </div>
        {LIGNES_COMPARATIF.map((ligne) => (
          <div className="comparatif-row" style={styles.comparatifRow} role="row" key={ligne.cle}>
            <div style={styles.comparatifLabel} role="cell">
              {t(ligne.cle)}
            </div>
            {plans.map((p) => (
              <CelluleComparatif key={p} inclus={Boolean(ligne[p])} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Abonnement({ etablissement, planEffectif, enEssai, onSupprimerCompte, t }) {
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
          compact
        />

        {/* Les 3 forfaits en détail : 9 caractéristiques × 3 colonnes */}
        <ComparatifForfaits t={t} />
      </div>

      {/* Zone sensible : suppression du compte utilisateur */}
      <SupprimerCompte onSupprimer={onSupprimerCompte} t={t} />
    </div>
  );
}

function SupprimerCompte({ onSupprimer, t }) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState("");

  const confirmer = async () => {
    setEnCours(true);
    const ok = await onSupprimer();
    setEnCours(false);
    if (!ok) setMessage(t("compte_supprimer_erreur"));
  };

  return (
    <div style={styles.dangerCard}>
      <div style={styles.dangerTitle}>{t("compte_supprimer_titre")}</div>
      {!ouvert ? (
        <button style={styles.dangerBtn} onClick={() => setOuvert(true)}>
          <Trash2 size={14} /> {t("compte_supprimer")}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={styles.dangerText}>{t("compte_supprimer_texte")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.dangerBtnConfirm} onClick={confirmer} disabled={enCours}>
              {enCours ? t("compte_supprimer_en_cours") : t("compte_supprimer_confirmer")}
            </button>
            <button style={styles.dangerBtnGhost} onClick={() => { setOuvert(false); setMessage(""); }}>
              {t("compte_supprimer_annuler")}
            </button>
          </div>
          {message && <div style={styles.errorBanner}>{message}</div>}
        </div>
      )}
    </div>
  );
}

function RecuperationMotDePasse({ t, onTermine }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [etat, setEtat] = useState(null); // null | envoi | succes | erreur
  const [message, setMessage] = useState("");

  const enregistrer = async () => {
    setMessage("");
    if (!motDePasse || motDePasse.length < 6) {
      setMessage(t("auth_erreur_mdp"));
      setEtat("erreur");
      return;
    }
    if (motDePasse !== confirmation) {
      setMessage(t("recup_mdp_different"));
      setEtat("erreur");
      return;
    }
    setEtat("envoi");
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    if (error) {
      setMessage(t("recup_erreur"));
      setEtat("erreur");
      return;
    }
    setEtat("succes");
    try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
    setTimeout(() => onTermine(), 1800);
  };

  return (
    <div style={styles.recupWrap}>
      <div style={styles.recupCard}>
        <div style={styles.recupBrand}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke="#D4A24C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={styles.brandName}>ComptaCi</span>
        </div>
        <div style={styles.cardTitle}>{t("recup_titre")}</div>
        <div style={styles.cardCaption}>{t("recup_sous")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t("recup_nouveau_mdp")}</span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder={t("auth_mdp_placeholder")}
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t("recup_confirmation")}</span>
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={t("auth_mdp_placeholder")}
              style={styles.input}
              onKeyDown={(e) => { if (e.key === "Enter") enregistrer(); }}
            />
          </label>
          <button onClick={enregistrer} disabled={etat === "envoi"} style={styles.submitBtn}>
            {etat === "envoi" ? t("recup_enregistrement") : t("recup_enregistrer")}
          </button>
          {etat === "succes" && <div style={styles.recupSucces}>{t("recup_succes")}</div>}
          {etat === "erreur" && message && <div style={styles.errorBanner}>{message}</div>}
        </div>
      </div>
      <div style={styles.appFooter}>SHOPIN30 · 05 01 30 33 43</div>
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

  const duMois = transactions.filter((t) => monthKey(t.date) === curKey);
  const nbVentes = duMois.filter((t) => t.type === "vente").length;
  const nbDepenses = duMois.filter((t) => t.type === "depense").length;
  const panierMoyen = nbVentes > 0 ? caMois / nbVentes : 0;

  // Dépenses du mois ventilées par grande nature de poste (achats, personnel…)
  const postes = { achats: 0, personnel: 0, charges: 0, autre: 0 };
  duMois
    .filter((t) => t.type === "depense")
    .forEach((t) => {
      const poste = POSTES_PAR_CATEGORIE[t.categorie] || "autre";
      postes[poste] += Number(t.montant) || 0;
    });

  return {
    caMois,
    depMois,
    resultatMois,
    margeMois,
    tvaMois,
    nbVentes,
    nbDepenses,
    panierMoyen,
    postes,
    caMoisPct: pct(caMois, caPrev),
    depMoisPct: pct(depMois, depPrev),
  };
}

/** Poids d'un poste de dépense par rapport au CA, avec son niveau d'alerte. */
function evaluerRatio(montant, ca, seuil) {
  const poids = ca > 0 ? (montant / ca) * 100 : 0;
  let niveau = "sans";
  if (ca > 0 && montant > 0) {
    niveau = poids <= seuil ? "sain" : poids <= seuil * 1.25 ? "surveiller" : "alerte";
  }
  return { poids, niveau };
}

/** Classement des produits vendus sur une période (quantités, CA, part du CA). */
function buildTopProduits(transactions, periodeKey, limite = 6) {
  const totaux = new Map();
  transactions
    .filter((tx) => monthKey(tx.date) === periodeKey && tx.type === "vente")
    .forEach((tx) => {
      const nom = designationTransaction(tx);
      if (!nom) return;
      const cle = nom.toLowerCase();
      const precedent = totaux.get(cle) || { designation: nom, quantite: 0, ca: 0, nbVentes: 0 };
      precedent.quantite += quantiteTransaction(tx);
      precedent.ca += Number(tx.montant) || 0;
      precedent.nbVentes += 1;
      totaux.set(cle, precedent);
    });
  const liste = [...totaux.values()].sort((a, b) => b.ca - a.ca);
  const caTotal = liste.reduce((a, p) => a + p.ca, 0);
  return liste.slice(0, limite).map((p) => ({
    ...p,
    part: caTotal > 0 ? (p.ca / caTotal) * 100 : 0,
  }));
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
    id: c.id,
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
.kpi-row-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.grid-two {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
}

@media (max-width: 980px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .kpi-row-3 { grid-template-columns: repeat(2, 1fr); }
  .grid-two { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .kpi-row { grid-template-columns: 1fr; }
  .kpi-row-3 { grid-template-columns: 1fr; }
}

@media (max-width: 780px) {
  .page-banner { margin: 12px 16px 0 !important; height: 96px !important; }
}

@media (max-width: 760px) {
  .comparatif-row { grid-template-columns: 1.5fr repeat(3, 1fr) !important; gap: 4px !important; font-size: 11px !important; }
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
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9,
    background: "#FBF9F4", flexWrap: "wrap",
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
  comparatifCard: {
    marginTop: 18,
    border: "1px solid #EDE7DA",
    borderRadius: 14,
    background: "#FFFEFB",
    padding: "14px 14px 8px",
  },
  comparatifTitre: {
    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: "#16213E", marginBottom: 10,
  },
  comparatifTable: { display: "flex", flexDirection: "column" },
  comparatifRow: {
    display: "grid",
    gridTemplateColumns: "1.7fr 1fr 1fr 1fr",
    gap: 6,
    alignItems: "center",
    padding: "8px 4px",
    borderTop: "1px solid #F1ECE2",
    fontSize: 12,
    color: "#5C5748",
  },
  comparatifHead: {
    display: "grid",
    gridTemplateColumns: "1.7fr 1fr 1fr 1fr",
    gap: 6,
    alignItems: "center",
    padding: "4px 4px 8px",
    borderTop: "none",
  },
  comparatifLabel: { fontSize: 11.5, lineHeight: 1.35, color: "#5C5748" },
  comparatifLabelHead: { fontSize: 10.5, fontWeight: 700, color: "#8A8578", textTransform: "uppercase" },
  comparatifColHead: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textAlign: "center" },
  comparatifColNom: { fontFamily: "'Fraunces', serif", fontSize: 12.5, fontWeight: 600, color: "#16213E" },
  comparatifColPrix: { fontSize: 10.5, fontWeight: 700, color: "#B4801F" },
  comparatifCell: { display: "flex", alignItems: "center", justifyContent: "center" },
  comparatifCheck: { fontSize: 11, lineHeight: 1 },
  stockQty: {
    fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: "#16213E", minWidth: 40, textAlign: "center",
  },
  stockQtyLow: { color: "#B4432A" },
  stockValeur: { minWidth: 96, textAlign: "right", flexShrink: 0 },
  stockValeurMontant: {
    fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "#16213E", whiteSpace: "nowrap",
  },
  stockValeurDetail: { fontSize: 11, color: "#8A8578", marginTop: 1, whiteSpace: "nowrap" },
  stockSeuilField: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0,
  },
  stockSeuilLabel: {
    fontSize: 9, fontWeight: 700, color: "#8A8578", textTransform: "uppercase", letterSpacing: "0.04em",
  },
  stockSeuilInput: {
    width: 52, padding: "5px 6px", borderRadius: 7, border: "1px solid #E4DDD0",
    fontSize: 12, fontFamily: "'Inter', sans-serif", color: "#5C5748", outline: "none", textAlign: "center",
  },
  stockApercu: {
    flex: "1 1 100%", background: "#FBF3E2", borderRadius: 9, padding: "10px 14px",
    display: "flex", flexDirection: "column", gap: 2,
  },
  stockApercuTitre: { fontSize: 11.5, fontWeight: 600, color: "#8A6420", textTransform: "uppercase" },
  stockApercuValeur: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: "#16213E" },
  stockApercuDetail: { fontSize: 11.5, color: "#8A6420" },

  // Guide pédagogique de la caisse
  caisseConsigne: {
    fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#16213E", lineHeight: 1.35,
  },
  guideCard: {
    border: "1px solid #EDE7DA", borderRadius: 12, background: "#FBF9F4", marginBottom: 18, overflow: "hidden",
  },
  guideToggle: {
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px",
    background: "transparent", border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif",
    fontSize: 13.5, fontWeight: 600, color: "#16213E", textAlign: "left",
  },
  guideBody: { padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 14 },
  guideTexte: { fontSize: 13, lineHeight: 1.6, color: "#5C5748", margin: 0 },
  guideFormule: { background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 10, padding: "12px 14px" },
  guideFormuleTitre: { fontSize: 11.5, fontWeight: 700, color: "#8A8578", textTransform: "uppercase", marginBottom: 6 },
  guideFormuleLigne: {
    fontFamily: "'Fraunces', serif", fontSize: 14.5, fontWeight: 600, color: "#16213E", lineHeight: 1.45,
  },
  guideFormuleNote: { fontSize: 11.5, color: "#8A8578", marginTop: 6, lineHeight: 1.5 },
  guideEtapesTitre: { fontSize: 11.5, fontWeight: 700, color: "#8A8578", textTransform: "uppercase" },
  guideEtapes: {
    listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10,
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  },
  guideEtape: { display: "flex", gap: 9, alignItems: "flex-start" },
  guideEtapeNumero: {
    width: 21, height: 21, borderRadius: "50%", background: "#16213E", color: "#F3D9A0",
    fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  guideEtapeTitre: { fontSize: 12.5, fontWeight: 600, color: "#16213E" },
  guideEtapeTexte: { fontSize: 11.5, color: "#8A8578", lineHeight: 1.5, marginTop: 2 },
  montantsRapides: { display: "flex", flexDirection: "column", gap: 7 },
  montantsRapidesLabel: { fontSize: 11.5, fontWeight: 600, color: "#8A8578", textTransform: "uppercase" },
  montantsRapidesRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  montantRapideBtn: {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #E4DDD0", background: "#FFFEFB",
    color: "#16213E", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  montantRapideBtnActif: { background: "#16213E", borderColor: "#16213E", color: "#F3D9A0" },

  // Analyse sectorielle du tableau de bord
  secteurBadge: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999,
    background: "#EAECF3", color: "#16213E", fontSize: 12, fontWeight: 600,
  },
  cardMontant: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#16213E" },
  repartitionHead: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6,
  },
  repartitionLabel: { fontSize: 13, fontWeight: 500, color: "#16213E" },
  repartitionMontant: { fontSize: 12.5, fontWeight: 600, color: "#5C5748", whiteSpace: "nowrap" },
  repartitionDetail: { fontSize: 11.5, color: "#8A8578", marginTop: 5 },
  barTrack: { height: 8, borderRadius: 999, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999, transition: "width 0.3s ease" },
  ratioBadge: {
    display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
    background: "#F1ECE2", color: "#8A8578",
  },
  ratioSain: { background: "#E4F2EC", color: "#186B4E" },
  ratioSurveiller: { background: "#FBF3E2", color: "#B4801F" },
  ratioAlerte: { background: "#FBEBE4", color: "#B4432A" },
  conseilsCard: {
    background: "#FFFEFB", border: "1px solid #E8D9B5", borderRadius: 14, padding: 20,
  },
  conseilsHeader: { display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 14 },
  conseilsIcon: {
    width: 28, height: 28, borderRadius: 8, background: "#FBF3E2", color: "#B4801F",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  conseilsMarge: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    background: "#FBF3E2", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#8A6420", fontWeight: 600,
  },
  conseilsListe: {
    margin: "14px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 9,
  },
  conseilItem: { fontSize: 13, lineHeight: 1.6, color: "#5C5748" },
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
  dangerCard: {
    background: "#FFFEFB", border: "1px solid #EABBA9", borderRadius: 14, padding: 20,
  },
  dangerTitle: { fontFamily: "'Fraunces', serif", fontSize: 15.5, fontWeight: 600, color: "#B4432A", marginBottom: 10 },
  dangerText: { fontSize: 13, color: "#5C5748", lineHeight: 1.55, margin: 0 },
  dangerBtn: {
    display: "flex", alignItems: "center", gap: 7, padding: "10px 14px", borderRadius: 9,
    border: "1px solid #EABBA9", background: "#FBEBE4", color: "#B4432A", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  dangerBtnConfirm: {
    padding: "10px 14px", borderRadius: 9, border: "none", background: "#B4432A", color: "#FFFEFB",
    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  dangerBtnGhost: {
    padding: "10px 14px", borderRadius: 9, border: "1px solid #E4DDD0", background: "transparent", color: "#8A8578",
    fontSize: 13, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  recupWrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    background: "#FBF7F0", padding: 20, fontFamily: "'Inter', sans-serif",
  },
  recupCard: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380,
  },
  recupBrand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 18 },
  recupSucces: { fontSize: 13, color: "#186B4E", background: "#E4F2EC", padding: "10px 12px", borderRadius: 8 },
};
