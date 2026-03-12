import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const askAI = async (prompt: string, history: { role: string, parts: { text: string }[] }[] = []) => {
  try {
    const model = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history,
        { role: "user", parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction: "You are SyncBot, a helpful AI assistant integrated into SyncChat. Keep your responses concise and friendly. You can help with summaries, translations, and general questions.",
      }
    });

    const response = await model;
    return response.text || "I'm sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("Gemini AI Error:", error);
    return "Sorry, I'm having trouble connecting to my AI brain right now.";
  }
};
