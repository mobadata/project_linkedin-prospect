# Configuration du cron pour les campagnes en arrière-plan

Pour que les invitations envoyées en arrière-plan soient traitées (20/jour max par utilisateur), le cron doit appeler l’API toutes les **5 minutes**.

## Plan Vercel Hobby (gratuit)

Le cron Vercel Hobby ne permet qu’**1 exécution par jour**. Pour 20 invitations/jour, utilisez un cron externe (gratuit).

## Option : cron-job.org (gratuit)

1. Créez un compte sur [cron-job.org](https://cron-job.org)
2. **Nouveau cron job** :
   - **URL :** `https://VOTRE-APP.vercel.app/api/linkedin/campaign/process`
   - **Méthode :** GET
   - **En-têtes :** `x-cron-secret: VOTRE_CRON_SECRET` (la même valeur que dans Vercel)
   - **Planification :** toutes les 5 minutes → `*/5 * * * *`
3. **CRON_SECRET** dans Vercel : Settings → Environment Variables.

## Déroulement

1. L’utilisateur clique sur « Lancer en arrière-plan » à n’importe quelle heure → les prospects sont mis en file.
2. Le cron appelle l’API toutes les 5 min → 1 invitation est traitée à chaque appel.
3. Résultat : ~12 invitations/heure si la file est pleine, jusqu’à ~20/jour (limite anti-ban).

## En local

```bash
npm run dev:cron
```

Lance un script qui appelle l’API toutes les 5 min sur `http://localhost:3000`.
