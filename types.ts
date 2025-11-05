export type Page = 'home' | 'style-me' | 'trends' | 'item-finder';

export interface OutfitItem {
  type: string;
  description: string;
}

export interface OutfitRecommendation {
  outfitName: string;
  description: string;
  items: OutfitItem[];
  imageUrl: string;
}

export interface Trend {
    name: string;
    description: string;
    keyItems: string[];
    imageUrl: string;
    sourceUrls?: { uri: string; title?: string }[]; // Thêm sourceUrls
}

export interface ItemAnalysis {
    description: string;
    imageUrl: string;
    sourceUrls?: { uri: string; title?: string }[]; // Thêm sourceUrls
}