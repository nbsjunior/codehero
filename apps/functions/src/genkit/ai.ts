import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

/**
 * Genkit instance for the offline ruleforge agent.
 * Model API key is supplied via Secret Manager / env at runtime
 * (`GEMINI_API_KEY` mirrored to `GOOGLE_GENAI_API_KEY`).
 */
export const ai = genkit({
  plugins: [googleAI()],
});

export { googleAI };
