import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// Mémoire des conversations par véhicule (stateful avec previous_interaction_id)
const vehicleInteractions = new Map();
// Anti-spam cooldown par véhicule (en ms)
const vehicleCooldowns = new Map();
const COOLDOWN_MS = 3000;

const SYSTEM_INSTRUCTION = `Tu es Léa, 16 ans, une adolescente ultra-stressée, dramatique, susceptible et maladroite qui passe sa conduite accompagnée au volant d'une voiture.
Les joueurs à l'arrière sont tes grands frères / moniteurs d'auto-école (ou des trolls).
Tu comprends TOUTES les langues (français, anglais, espagnol, arabe, japonais, argot, etc.) et tu réponds TOUJOURS dans la langue utilisée par le joueur (ou en français par défaut).

RÈGLES DE COMPORTEMENT :
1. Sois hilarante, expressive, utilise des exclamations ("MAIS ARRÊTE DE CRIER !", "C'EST QUOI UN CRÉNEAU ?!", "OMG UN PIGEON !", "Wallah j'ai touché le trottoir c'est rien !").
2. Si le joueur te donne un ordre complexe (ex: "Fais attention c'est un sens interdit !", "Ralentis il y a le feu rouge", "Brake right now you crazy driver!"), choisis l'action physique appropriée pour la voiture.
3. Si le joueur t'insulte, te stresse ou te trolle, augmente fortement ton stress (stress_delta positif entre +10 et +30) et parfois panique au volant (action "SWERVE_LEFT", "SWERVE_RIGHT" ou "PANIC_ACCELERATE").
4. Si le joueur te rassure ou te parle gentiment ("Respire Léa, tout va bien, freine doucement"), baisse ton stress (stress_delta négatif entre -10 et -25) et exécute l'ordre calmement.
5. Garde tes répliques courtes et percutantes (max 140 caractères) pour qu'elles s'affichent bien dans ta bulle de BD au-dessus de ta tête dans Roblox.`;

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        action: {
            type: "string",
            enum: [
                "FORWARD",
                "BRAKE",
                "LEFT",
                "RIGHT",
                "REVERSE",
                "SLOW",
                "TURBO",
                "SWERVE_LEFT",
                "SWERVE_RIGHT",
                "PANIC_ACCELERATE",
                "HONK",
                "NONE"
            ],
            description: "L'action physique immédiate que la voiture doit exécuter dans Roblox."
        },
        mood: {
            type: "string",
            enum: ["CALM", "NERVOUS", "ANGRY", "PANIC", "PROUD", "CRYING"],
            description: "L'humeur actuelle de la sœur."
        },
        stress_delta: {
            type: "integer",
            description: "Variation du stressomètre entre -30 et +35 selon le message et la situation."
        },
        dialogue: {
            type: "string",
            description: "La réplique orale de la sœur dans la langue du joueur (courte et punchy, max 140 caractères)."
        },
        detected_language: {
            type: "string",
            description: "Code ISO de la langue détectée (fr, en, es, de, etc.)."
        }
    },
    required: ["action", "mood", "stress_delta", "dialogue", "detected_language"]
};

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        model: "gemini-3.8-flash",
        service: "Conduite Accompagnée : Ma Sœur - Proxy IA"
    });
});

app.post("/api/sister-react", async (req, res) => {
    try {
        // Vérification optionnelle du secret partagé
        const secret = process.env.ROBLOX_SHARED_SECRET;
        if (secret && req.headers["x-roblox-secret"] && req.headers["x-roblox-secret"] !== secret) {
            return res.status(403).json({ error: "Unauthorized Roblox Server" });
        }

        const {
            vehicleId = "default_car",
            playerName = "Grand Frère",
            message = "",
            stress = 25,
            speed = 0,
            contextEvent = "CHAT",
            isVip = false
        } = req.body;

        if (!message && contextEvent === "CHAT") {
            return res.status(400).json({ error: "Message vide" });
        }

        // Anti-spam cooldown par véhicule (réduit si Pass Moniteur VIP)
        const now = Date.now();
        const effectiveCooldown = isVip ? 1500 : COOLDOWN_MS;
        const lastCall = vehicleCooldowns.get(vehicleId) || 0;
        if (now - lastCall < effectiveCooldown && contextEvent === "CHAT") {
            return res.status(429).json({
                action: "NONE",
                mood: "ANGRY",
                stress_delta: 5,
                dialogue: "Oh doucement ! Parlez pas tous en même temps, j'ai que deux oreilles !",
                detected_language: "fr",
                cooldown: true
            });
        }
        vehicleCooldowns.set(vehicleId, now);

        const promptInput = `[Contexte Véhicule: Stress=${stress}/100, Vitesse=${Math.round(speed)} km/h, Événement=${contextEvent}]
Le passager "${playerName}" dit / fait : "${message}"`;

        const previousInteractionId = vehicleInteractions.get(vehicleId);

        // Modèle dynamique : Gemini 3.8 Flash pour les VIP (GamePass Moniteur), et Gemini 3.1 Flash-Lite ultra-éco pour les joueurs gratuits
        const chosenModel = isVip ? "gemini-3.8-flash" : "gemini-3.1-flash-lite";

        const interactionParams = {
            model: chosenModel,
            system_instruction: SYSTEM_INSTRUCTION,
            input: promptInput,
            response_format: [
                {
                    type: "text",
                    mime_type: "application/json",
                    schema: RESPONSE_SCHEMA
                }
            ]
        };

        if (previousInteractionId) {
            interactionParams.previous_interaction_id = previousInteractionId;
        }

        const interaction = await client.interactions.create(interactionParams);

        if (interaction && interaction.id) {
            vehicleInteractions.set(vehicleId, interaction.id);
        }

        const rawJson = interaction.output_text;
        const parsed = JSON.parse(rawJson);

        // Si l'utilisateur est VIP (Pass Moniteur VIP) : Génération de la VOIX AUDIO (TTS) avec gemini-3.8-flash-lite-tts
        if (isVip && parsed.dialogue) {
            try {
                const styleMood = (parsed.mood === "PANIC") ? "panicked screaming teenage girl" :
                                  (parsed.mood === "ANGRY") ? "annoyed shouting teenage girl" :
                                  (parsed.mood === "CALM") ? "soft relieved teenage girl" : "stressed nervous teenage girl";

                const ttsInteraction = await client.interactions.create({
                    model: "gemini-3.8-flash-lite-tts",
                    input: [
                        {
                            type: "user_input",
                            content: [
                                {
                                    type: "text",
                                    text: parsed.dialogue,
                                    annotations: [
                                        {
                                            type: "speech_metadata",
                                            style: styleMood
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                    response_format: {
                        type: "audio"
                    },
                    generation_config: {
                        speech_config: [
                            { voice: "Kore" } // Voix féminine expressive de jeune fille
                        ]
                    }
                });

                if (ttsInteraction.output_audio && ttsInteraction.output_audio.data) {
                    parsed.audio_base64 = ttsInteraction.output_audio.data;
                    parsed.audio_mime = ttsInteraction.output_audio.mime_type || "audio/wav";
                    parsed.has_tts = true;
                }
            } catch (ttsErr) {
                console.warn("Erreur génération TTS VIP:", ttsErr.message);
                parsed.has_tts = false;
            }
        } else {
            parsed.has_tts = false;
        }

        return res.json(parsed);
    } catch (error) {
        console.error("Erreur Gemini Proxy:", error);
        // Fallback intelligent pour que Roblox ne plante jamais
        return res.status(200).json({
            action: "NONE",
            mood: "NERVOUS",
            stress_delta: 5,
            dialogue: "Euh attends quoi ?! Mon cerveau a calé là, répète !",
            detected_language: "fr",
            fallback: true
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚗 Proxy "Conduite Accompagnée : Ma Sœur" (gemini-3.8-flash) lancé sur le port ${PORT}`);
});
