// ============================================
// LLM BRANDING - Colors and labels for AI tournament
// ============================================

export interface LLMBrand {
  name: string;
  color: string;       // Hex color for labels/tints
  colorNum: number;    // Numeric color for PixiJS
  shortName: string;   // Short display name
  shipImage: string;   // Path to LLM-specific ship PNG
}

export const LLM_BRANDS: Record<string, LLMBrand> = {
  'GPT-4': {
    name: 'GPT-4',
    color: '#10A37F',
    colorNum: 0x10A37F,
    shortName: 'GPT-4',
    shipImage: '/images/ships/llm/gpt4.png',
  },
  'Claude': {
    name: 'Claude',
    color: '#D97757',
    colorNum: 0xD97757,
    shortName: 'Claude',
    shipImage: '/images/ships/llm/claude.png',
  },
  'Grok': {
    name: 'Grok',
    color: '#1DA1F2',
    colorNum: 0x1DA1F2,
    shortName: 'Grok',
    shipImage: '/images/ships/llm/grok.png',
  },
  'Gemini': {
    name: 'Gemini',
    color: '#4285F4',
    colorNum: 0x4285F4,
    shortName: 'Gemini',
    shipImage: '/images/ships/llm/gemini.png',
  },
  'DeepSeek': {
    name: 'DeepSeek',
    color: '#1E3A5F',
    colorNum: 0x1E3A5F,
    shortName: 'DeepSk',
    shipImage: '/images/ships/llm/deepseek.png',
  },
};

/**
 * Get LLM brand info by agent name.
 * Returns undefined if the name doesn't match a known LLM.
 */
export function getLLMBrand(name?: string): LLMBrand | undefined {
  if (!name) return undefined;
  return LLM_BRANDS[name];
}
