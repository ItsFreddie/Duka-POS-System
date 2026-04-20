import { GoogleGenAI, Chat } from "@google/genai";
import { Product, Transaction } from "../types";

let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export const createBusinessChat = (sales: Transaction[], inventory: Product[]): Chat | null => {
  const ai = getAIClient();
  if (!ai) return null;

  const recentSales = sales.slice(0, 50);
  const lowStock = inventory.filter(p => p.stock < 5).map(p => p.name);
  
  const salesSummary = recentSales.map(s => 
    `${new Date(s.date).toLocaleDateString()}: ${s.total} KES via ${s.paymentMethod}`
  ).join('\n');

  const systemInstruction = `
    You are an expert business consultant for a retail shop in Nairobi, Kenya.
    
    Context:
    - Current low stock items: ${lowStock.join(', ') || 'None'}
    - Recent Sales History (last 50 transactions):
    ${salesSummary}
    
    Task:
    Answer the user's follow-up questions regarding their business, sales, inventory, or general retail advice.
    Focus on local Kenyan context (e.g., M-Pesa usage, popular trends).
    Keep it encouraging and professional.
  `;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction,
    }
  });
};

export const getBusinessInsights = async (
  sales: Transaction[], 
  inventory: Product[]
): Promise<string> => {
  const ai = getAIClient();
  if (!ai) return "Please configure your API Key to receive AI insights.";

  const recentSales = sales.slice(0, 50); // Analyze last 50 sales to save tokens
  const lowStock = inventory.filter(p => p.stock < 5).map(p => p.name);
  
  const salesSummary = recentSales.map(s => 
    `${new Date(s.date).toLocaleDateString()}: ${s.total} KES via ${s.paymentMethod}`
  ).join('\n');

  const prompt = `
    You are an expert business consultant for a retail shop in Nairobi, Kenya.
    
    Context:
    - Current low stock items: ${lowStock.join(', ') || 'None'}
    - Recent Sales History (last 50 transactions):
    ${salesSummary}
    
    Task:
    Provide 3 brief, actionable insights or tips (bullet points) to improve profit, manage stock, or handle cash flow better. 
    Focus on local Kenyan context (e.g., M-Pesa usage, popular trends).
    Keep it encouraging and professional.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "No insights available at the moment.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Unable to fetch insights. Please check your internet connection.";
  }
};

export const generateProductDescription = async (productName: string, category: string): Promise<string> => {
  const ai = getAIClient();
  if (!ai) return "";
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Write a short, catchy 1-sentence description for a product named "${productName}" in the category "${category}" for a shop.`,
    });
    return response.text || "";
  } catch (error) {
    return "";
  }
}
