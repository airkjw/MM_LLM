export const modelNames: Record<string, string> = {
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.5": "GPT-5.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5": "Claude Opus 5",
  "claude-fable-5-1": "Claude Fable 5.1",
  "claude-fable-5": "Claude Fable 5",
  "claude-opus-4-8": "Claude 4.8 Opus",
  "claude-haiku-4-5-20251001": "Claude 4.5 Haiku",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "grok-4.6": "Grok 4.6",
  "grok-4.5": "Grok 4.5",
  "grok-4-1-fast": "Grok 4.1 Fast",
  "google/gemma-4-31B-it": "Gemma 4",
  "muse-spark-1.3": "Muse Spark 1.3",
  "sonar-pro": "Sonar Pro",
  "sonar-reasoning-pro": "Sonar Reasoning Pro",
  "solar-pro4": "Solar Pro 4",
  "qwen3.8-max": "Qwen 3.8 Max",
  "qwen3.7-plus": "Qwen 3.7 Plus",
  "qwen3.7-max": "Qwen 3.7 Max",
  "glm-5.3-flash": "GLM-5.3-Flash",
  "glm-5.3": "GLM-5.3",
  "glm-5.2": "GLM-5.2",
  "kimi-k3": "Kimi K3",
  "seed-2-0-pro-260328": "Seed 2.0 Pro",
  "seed-2-0-lite-260428": "Seed 2.0 Lite",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash"
};

export function modelLabel(id: string): string {
  return modelNames[id] ?? id
    .replace(/^.*\//, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function providerLabel(owner?: string): string {
  const labels: Record<string, string> = {
    openai: "OpenAI", claude: "Anthropic", anthropic: "Anthropic",
    gemini: "Google", google: "Google", xai: "xAI",
    perplexity: "Perplexity", upstage: "Upstage"
  };
  return labels[owner ?? ""] ?? (owner || "기타");
}
