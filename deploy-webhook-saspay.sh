#!/usr/bin/env bash
# ============================================================================
# ComptaCi — Déploiement de l'Edge Function « webhook-saspay »
# ----------------------------------------------------------------------------
# Pré-requis
#   1. Un « access token » Supabase : https://supabase.com/dashboard/account/tokens
#   2. Le « project ref » : Supabase → Project settings → General → Reference ID
#      (il est aussi visible dans l'URL du projet : https://app.supabase.com/project/<REF>)
#   3. La CLI Supabase : npm i -g supabase   (déjà installée ? supabase --version)
#
# Usage
#   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
#   ./deploy-webhook-saspay.sh <project-ref>
#
# ou directement :
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./deploy-webhook-saspay.sh abcdefghijklmnop
#
# Le script déploie la fonction (signature HMAC vérifiée côté fonction, donc
# --no-verify-jwt) et affiche l'URL à coller dans le tableau de bord SasPay.
# ============================================================================

set -euo pipefail

PROJET="${1:-${SUPABASE_PROJECT_REF:-}}"
JETON="${SUPABASE_ACCESS_TOKEN:-}"

if [ -z "$JETON" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN n'est pas défini."
  echo "   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx"
  echo "   (token à créer ici : https://supabase.com/dashboard/account/tokens)"
  exit 1
fi

if [ -z "$PROJET" ]; then
  echo "❌ Project ref manquant."
  echo "   Usage : ./deploy-webhook-saspay.sh <project-ref>"
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "⚙️  Installation de la CLI Supabase…"
  npm i -g supabase
fi

echo "🚀 Déploiement de webhook-saspay sur le projet $PROJET…"
# --use-api : bundle côté serveur (indispensable sans Docker installé).
if ! SUPABASE_ACCESS_TOKEN="$JETON" supabase functions deploy webhook-saspay \
  --project-ref "$PROJET" \
  --no-verify-jwt \
  --use-api; then
  echo "⚠️  Échec avec --use-api, nouvel essai sans cette option…"
  SUPABASE_ACCESS_TOKEN="$JETON" supabase functions deploy webhook-saspay \
    --project-ref "$PROJET" \
    --no-verify-jwt
fi

echo
echo "✅ Déployé. URL à coller dans le tableau de bord SasPay (webhook) :"
echo "   https://${PROJET}.supabase.co/functions/v1/webhook-saspay"
echo
echo "🔎 Vérification (doit renvoyer {\"ok\":true,\"secret_configure\":true}) :"
echo "   curl https://${PROJET}.supabase.co/functions/v1/webhook-saspay"
echo
echo "🔐 Rappel : le secret SASPAY_WEBHOOK_SECRET doit exister sur le projet :"
echo "   supabase secrets set SASPAY_WEBHOOK_SECRET=xxxxx --project-ref $PROJET"
echo "   supabase secrets list --project-ref $PROJET"
