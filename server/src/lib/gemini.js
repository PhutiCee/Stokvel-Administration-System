"use strict";

/**
 * Minimal Gemini API client for the assistant (Use Case 6).
 *
 * One JSON POST over the platform's built-in fetch (Node 18+) rather than an
 * added SDK dependency, matching the project's preference for small,
 * auditable code over a package pulled in for a single call site.
 */

const { env } = require("../config/env");

const ENDPOINT = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * @param {{ system: string, question: string }} args
 * @returns {Promise<string>} the model's text reply
 * @throws if the key is missing, the request fails, or the response is empty
 */
async function askGemini({ system, question }) {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");

    const response = await fetch(`${ENDPOINT(env.GEMINI_MODEL)}?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: question }] }]
        }),
        signal: AbortSignal.timeout(25_000)
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Gemini API returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text.trim()) throw new Error("Gemini returned an empty response.");
    return text.trim();
}

module.exports = { askGemini };
