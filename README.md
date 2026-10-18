# 🚗 Conduite Accompagnée : Ma Sœur - Serveur Proxy Gemini 3.8 Flash

Serveur Proxy Node.js pour le jeu Roblox **"Conduite Accompagnée : Ma Sœur"**.
Il connecte la voiture de Léa dans Roblox à l'API **Google Gemini 3.8 Flash (Interactions API)** en streaming/JSON structuré.

## 🚀 Déploiement en 5 minutes sur Render

### 1. Cloner ou Pusher sur GitHub
Depuis ce dossier `proxy-server` :
```bash
git init
git add .
git commit -m "Initial commit - Serveur Proxy Gemini 3.8 Flash"
git branch -M main
git remote add origin https://github.com/VOTRE_USER/conduite-soeur-proxy.git
git push -u origin main
```

### 2. Créer le Web Service sur [Render.com](https://render.com)
1. Cliquez sur **New +** -> **Web Service**.
2. Sélectionnez votre dépôt GitHub `conduite-soeur-proxy`.
3. Paramètres de configuration :
   - **Name** : `conduite-soeur-proxy`
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : `Free`
4. Ajoutez vos **Environment Variables** :
   - `GEMINI_API_KEY` : Votre clé API Google Gemini (AI Studio).
   - `ROBLOX_SHARED_SECRET` : `mon_secret_conduite_2026` (optionnel pour sécuriser l'accès).
5. Cliquez sur **Create Web Service**.

### 3. Brancher l'URL dans Roblox Studio
Une fois déployé, Render vous donne une URL publique (ex: `https://conduite-soeur-proxy.onrender.com`).
Dans Roblox Studio, ouvrez `ReplicatedStorage.GameConfig` et mettez à jour la ligne :
```lua
GameConfig.PROXY_URL = "https://conduite-soeur-proxy.onrender.com/api/sister-react"
```

## 🛡️ Endpoints
- `GET /health` : Test de santé (utilisable par UptimeRobot ou Render Health Check pour éviter le cold-start).
- `POST /api/sister-react` : Réception des messages des joueurs et génération de la réaction de Léa (Action physique, Humeur, Stress, Réplique orale).
