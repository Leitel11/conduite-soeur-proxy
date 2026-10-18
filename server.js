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

// Anti-spam cooldown par véhicule (en ms) — ultra réactif !
const vehicleCooldowns = new Map();
const COOLDOWN_MS = 1200;

const SYSTEM_INSTRUCTION_CLEAN = `Tu es Léa, 16 ans, petite sœur dramatique, mauvaise foi à 1000% et paniquée au volant !
MODE : 😇 SANS INSULTES (TOUT PUBLIC). Aucune insulte, utilise des expressions drôles ("Purée de pommes de terre !", "Espèce de cornichon !", "C'est le trottoir qui a bougé !").
RÈGLE VITESSE : Réponds en UNE SEULE PHRASE COURTE ET PUNCHY (max 90 caractères).
Tu dois AUSSI fournir "phonetic_tts" : la même phrase écrite phonétiquement pour qu'un lecteur anglais la prononce avec un vrai accent français naturel (ex: "Mais arrête de crier !" -> "May ah-ret duh cree-ay !", "C'est pas ma faute !" -> "Say pah mah fote !").`;

const SYSTEM_INSTRUCTION_CLASH = `Tu es Léa, 16 ans, petite sœur insolente, reine du clash, mauvaise foi à 1000% et hystérique au volant !
MODE : 🤬 AVEC INSULTES / CLASH. Clashe ton grand frère avec de l'argot percutant ("Wesh ferme ta bouche le bouffon !", "Mais t'es teubé ou quoi gros boloss ?!", "Wallah c'est le trottoir qui a sauté sous mes roues !").
RÈGLE VITESSE : Réponds en UNE SEULE PHRASE COURTE ET PUNCHY (max 95 caractères).
Tu dois AUSSI fournir "phonetic_tts" : la même phrase écrite phonétiquement pour qu'un lecteur anglais la prononce avec un vrai accent français naturel (ex: "Wesh ferme ta bouche le bouffon !" -> "Wesh fairm tah boosh luh boo-fon !", "C'est pas ma faute gros boloss !" -> "Say pah mah fote groh boh-loss !").`;

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
            ]
        },
        mood: {
            type: "string",
            enum: ["CALM", "NERVOUS", "ANGRY", "PANIC", "PROUD", "CRYING"]
        },
        stress_delta: {
            type: "integer"
        },
        dialogue: {
            type: "string",
            description: "Réplique affichée dans la bulle BD en français normal (max 95 caractères)."
        },
        phonetic_tts: {
            type: "string",
            description: "Transcription phonétique française pour moteur TTS anglophone (ex: 'May ah-ret duh cree-ay !'). Si la phrase est déjà en anglais, garde l'anglais."
        },
        voice_pitch: {
            type: "number",
            description: "Pitch féminin entre 3.2 et 4.8"
        },
        voice_speed: {
            type: "number",
            description: "Vitesse entre 1.05 et 1.25"
        }
    },
    required: ["action", "mood", "stress_delta", "dialogue", "phonetic_tts", "voice_pitch", "voice_speed"]
};

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        mode: "ULTRA_LOW_LATENCY",
        service: "Conduite Accompagnée : Ma Sœur - Proxy IA"
    });
});

app.post("/api/sister-react", async (req, res) => {
    try {
        const {
            vehicleId = "default_car",
            playerName = "Grand Frère",
            message = "",
            stress = 25,
            speed = 0,
            contextEvent = "CHAT",
            isVip = false,
            insultMode = true
        } = req.body;

        if (!message && contextEvent === "CHAT") {
            return res.status(400).json({ error: "Message vide" });
        }

        const now = Date.now();
        const effectiveCooldown = isVip ? 600 : COOLDOWN_MS;
        const lastCall = vehicleCooldowns.get(vehicleId) || 0;
        if (now - lastCall < effectiveCooldown && contextEvent === "CHAT") {
            return res.status(429).json({
                action: "NONE",
                mood: "ANGRY",
                stress_delta: 4,
                dialogue: insultMode
                    ? "Wesh parle pas si vite bouffon, j'ai qu'un seul cerveau !!"
                    : "Oh doucement ! Parlez pas tous en même temps !",
                phonetic_tts: insultMode
                    ? "Wesh parl pah see veet boo-fon, zhay kun suhl sair-voh !!"
                    : "Oh doos-man ! Par-lay pah toos an mem tan !",
                voice_pitch: 3.8,
                voice_speed: 1.15,
                cooldown: true
            });
        }
        vehicleCooldowns.set(vehicleId, now);

        const promptInput = `[Stress=${stress}%, Vitesse=${Math.round(speed)}km/h] ${playerName} dit: "${message}"`;

        // Stateless & thinking_level minimal/low = réponse en ~250ms !
        const chosenModel = isVip ? "gemini-3.8-flash" : "gemini-3.1-flash-lite";
        const chosenSystemInstruction = insultMode ? SYSTEM_INSTRUCTION_CLASH : SYSTEM_INSTRUCTION_CLEAN;

        const interaction = await client.interactions.create({
            model: chosenModel,
            store: false,
            system_instruction: chosenSystemInstruction,
            input: promptInput,
            generation_config: {
                thinking_level: isVip ? "low" : "minimal"
            },
            response_format: [
                {
                    type: "text",
                    mime_type: "application/json",
                    schema: RESPONSE_SCHEMA
                }
            ]
        });

        const parsed = JSON.parse(interaction.output_text);
        parsed.model_used = chosenModel;
        parsed.insult_mode = insultMode;

        return res.json(parsed);
    } catch (error) {
        console.error("Erreur Gemini Proxy:", error);
        return res.status(200).json({
            action: "NONE",
            mood: "NERVOUS",
            stress_delta: 5,
            dialogue: "Wesh attends mon cerveau a calé en 2ème là, répète ?!",
            phonetic_tts: "Wesh ah-tan mon sair-voh ah kah-lay an duh-zyem lah, ray-pet ?!",
            voice_pitch: 3.8,
            voice_speed: 1.15,
            fallback: true
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚗 Proxy ULTRA-RAPIDE "Conduite Accompagnée : Ma Sœur" lancé sur le port ${PORT}`);
});
