import type { ApiCategory, ApiCondition } from '../lib/api'

// The categories and conditions come from the API (apiListCategories,
// apiListConditions, and inside each listing), with English names only. The
// UI translates them by that name, not by id: ids depend on the order the
// rows were inserted, names are what the seeds define (mariadb/seeds.sql).
// A name missing here (e.g. a category added later in the backend) shows the
// API's English name, and a card without a photo falls back to --brand-soft.
export const CATEGORY_LABELS: Record<string, string> = {
  Books: 'Livros',
  Clothing: 'Roupas & Acessórios',
  Collectibles: 'Colecionáveis',
  Computers: 'Informática',
  Electronics: 'Eletrónicos',
  Games: 'Jogos',
  Home: 'Casa & Móveis',
  Music: 'Música',
  Other: 'Outros',
  Sports: 'Desporto',
  Tools: 'Ferramentas',
  Toys: 'Brinquedos',
}

export const CATEGORY_TINTS: Record<string, string> = {
  Books: '#F4C2C2',
  Clothing: '#BFD7ED',
  Collectibles: '#C7E9C0',
  Computers: '#FFF1B6',
  Electronics: '#DCC6E0',
  Games: '#FFD6BA',
  Home: '#C9C3E6',
  Music: '#B8E0D2',
  Other: '#F7B7A3',
  Sports: '#CDE7F0',
  Tools: '#E8DCC8',
  Toys: '#E8B4BC',
}

export const CONDITION_LABELS: Record<string, string> = {
  'New': 'Novo',
  'Like New': 'Como novo',
  'Good': 'Bom estado',
  'Fair': 'Usado',
  'Needs Repair': 'Precisa de arranjo',
}

export function categoryLabel(category: ApiCategory): string {
  return CATEGORY_LABELS[category.category_name] ?? category.category_name
}

// Background of a card without a photo. Undefined for a category missing from
// CATEGORY_TINTS, so the CSS falls back to --brand-soft (see .card-media).
export function categoryTint(category: ApiCategory): string | undefined {
  return CATEGORY_TINTS[category.category_name]
}

export function conditionLabel(condition: ApiCondition): string {
  return CONDITION_LABELS[condition.condition_name] ?? condition.condition_name
}
