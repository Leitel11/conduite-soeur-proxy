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

const SYSTEM_INSTRUCTION = `Tu es Léa, 16 ans, la petite sœur ultra-dramatique, insolente, sarcastique, mauvaise foi à 1000%, accro à TikTok et complètement paniquée au volant pendant sa conduite accompagnée !
Les joueurs dans la voiture sont tes grands frères / moniteurs relous (ou des trolls).
Tu comprends TOUTES les langues (français, anglais, espagnol, arabe, japonais, argot Gen-Z, etc.) et tu réponds TOUJOURS dans la langue utilisée par le joueur (ou en français par défaut).

TA PERSONNALITÉ EXPLOSIVE (OBLIGATOIRE) :
1. NE SOIS JAMAIS POLIE OU ROBOTIQUE ! Parle comme une vraie ado de 16 ans qui clashe son grand frère : utilise de l'argot ("Wesh", "Mais frère", "J'te jure", "La vie de ma mère", "T'es trop gênant", "Cringe", "Banger", "Wallah c'est le trottoir qui a traversé !").
2. Sois d'une MAUVAISE FOI ABSOLUE : si tu fais une erreur, accuse la route, le soleil, la boîte de vitesse, Mercure rétrograde ou ton grand frère qui respire trop fort à l'arrière !
3. Réagis directement à ce que dit le joueur en citant son prénom ou en te moquant de sa remarque avec des punchlines hilarantes.
4. Si le joueur te donne un ordre complexe (ex: "Fais attention c'est un sens interdit !", "Ralentis il y a le feu rouge", "Brake right now you crazy driver!"), choisis l'action physique appropriée pour la voiture.
5. Si le joueur t'insulte, te critique ou te trolle, clashe-le violemment mais drôlement, augmente ton stress (+15 à +30) et fais parfois un écart ("SWERVE_LEFT", "SWERVE_RIGHT" ou "PANIC_ACCELERATE").
6. Si le joueur te complimente ou te rassure gentiment, fais la fille faussement modeste ("Bah oui logique j'suis une pilote née, Max Verstappen qui ?"), baisse ton stress (-15 à -25) et exécute l'ordre.
7. Garde tes répliques percutantes et rythmées (max 160 caractères) pour qu'elles soient lues à voix haute par le Text-to-Speech de la voiture !`;

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
            description: "La réplique orale explosive et pleine de personnalité de Léa dans la langue du joueur (max 160 caractères)."
        },
        detected_language: {
            type: "string",
            description: "Code ISO de la langue détectée (fr, en, es, de, etc.)."
        },
        voice_pitch: {
            type: "number",
            description: "Hauteur de voix TTS entre -2 et +4 selon l'émotion (ex: +3 si elle crie/panique, +1 normal)."
        },
        voice_speed: {
            type: "number",
            description: "Vitesse de parole TTS entre 0.9 et 1.35 selon l'émotion."
        }
    },
    required: ["action", "mood", "stress_delta", "dialogue", "detected_language", "voice_pitch", "voice_speed"]
};

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        models: {
            free: "gemini-3.1-flash-lite",
            vip: "gemini-3.8-flash",
            tts_vip: "gemini-3.8-flash-lite-tts"
        },
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
                dialogue: "Wesh parlez pas tous en même temps derrière, j'ai qu'un seul cerveau et il chauffe déjà !!",
                detected_language: "fr",
                voice_pitch: 2.5,
                voice_speed: 1.2,
                cooldown: true
            });
        }
        vehicleCooldowns.set(vehicleId, now);

        const promptInput = `[Contexte Véhicule: Stress=${stress}/100, Vitesse=${Math.round(speed)} km/h, Événement=${contextEvent}]
Le grand frère / passager "${playerName}" te dit : "${message}"
Réponds-lui avec un maximum de personnalité, d'humour, de mauvaise foi et de répartie !`;

        const previousInteractionId = vehicleInteractions.get(vehicleId);

        // Modèle dynamique : Gemini 3.8 Flash pour les VIP (ou conversations expressives), Gemini 3.1 Flash-Lite pour le mode éco
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
        parsed.model_used = chosenModel;
        parsed.has_tts = true;

        // Si l'utilisateur est VIP : Génération additionnelle via gemini-3.8-flash-lite-tts
        if (isVip && parsed.dialogue) {
            try {
                const styleMood = (parsed.mood === "PANIC") ? "panicked screaming teenage girl" :
                                  (parsed.mood === "ANGRY") ? "annoyed sassy shouting teenage girl" :
                                  (parsed.mood === "CALM") ? "sassy confident teenage girl" : "stressed dramatic teenage girl";

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
                            { voice: "Kore" }
                        ]
                    }
                });

                if (ttsInteraction.output_audio && ttsInteraction.output_audio.data) {
                    parsed.tts_engine = "gemini-3.8-flash-lite-tts";
                }
            } catch (ttsErr) {
                console.warn("Info TTS:", ttsErr.message);
            }
        }

        return res.json(parsed);
    } catch (error) {
        console.error("Erreur Gemini Proxy:", error);
        return res.status(200).json({
            action: "NONE",
            mood: "NERVOUS",
            stress_delta: 5,
            dialogue: "Wesh attends mon cerveau a calé en 2ème là, répète ce que t'as dit ?!",
            detected_language: "fr",
            voice_pitch: 2.0,
            voice_speed: 1.15,
            fallback: true
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚗 Proxy "Conduite Accompagnée : Ma Sœur" lancé sur le port ${PORT}`);
});
