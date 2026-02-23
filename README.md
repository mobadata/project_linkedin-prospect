# Prospection LinkedIn Automatisée

SaaS d'automatisation de la prospection LinkedIn avec intelligence artificielle.

## Fonctionnalités

- Connexion au compte LinkedIn
- Filtres de recherche de prospects (poste, secteur, localisation)
- Envoi automatique d'invitations (15-20/jour)
- Génération de messages personnalisés par IA
- Inbox centralisé pour toutes les conversations
- Résumé IA et scoring des prospects (chaud/tiède/froid)
- Reprise manuelle des conversations

## Stack technique

- **Frontend / Backend** : Next.js (App Router)
- **Base de données & Auth** : Supabase
- **IA** : OpenAI / Anthropic
- **Styling** : Tailwind CSS

## Installation

```bash
git clone https://github.com/Hall-IA/prospection-linkedin.git
cd prospection-linkedin
npm install
```

Crée un fichier `.env.local` :

```
NEXT_PUBLIC_SUPABASE_URL=ton_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=ta_clé
```

Puis lance :

```bash
npm run dev
```
