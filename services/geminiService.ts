import { GoogleGenAI } from "@google/genai";
import { Product, Transaction } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const getBusinessInsights = async (
  sales: Transaction[], 
  inventory: Product[]
): Promise<string> => {
  if (!apiKey) return "Please configure your API Key to receive AI insights.";

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
  if (!apiKey) return "";
  
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
