import type { ApiCategory, ApiCondition } from '../lib/api'

// Portuguese labels and card colours for the categories and conditions the
// API returns. The API only sends English names, so the UI translates by id.

// Keys are the ids from mariadb/seeds.sql (insertion order). A category or
// condition added there must also be added here; until then the helpers below
// fall back to the English name from the API.
export const CATEGORY_LABELS: Record<number, string> = {
  1: 'Livros',
  2: 'Roupas & Acessórios',
  3: 'Colecionáveis',
  4: 'Informática',
  5: 'Eletrónicos',
  6: 'Jogos',
  7: 'Casa & Móveis',
  8: 'Música',
  9: 'Outros',
  10: 'Desporto',
  11: 'Ferramentas',
  12: 'Brinquedos',
}

export const CATEGORY_TINTS: Record<number, string> = {
  1: '#F4C2C2',
  2: '#BFD7ED',
  3: '#C7E9C0',
  4: '#FFF1B6',
  5: '#DCC6E0',
  6: '#FFD6BA',
  7: '#C9C3E6',
  8: '#B8E0D2',
  9: '#F7B7A3',
  10: '#CDE7F0',
  11: '#E8DCC8',
  12: '#E8B4BC',
}

export const CONDITION_LABELS: Record<number, string> = {
  1: 'Novo',
  2: 'Como novo',
  3: 'Bom estado',
  4: 'Usado',
  5: 'Precisa de arranjo',
}

export function categoryLabel(category: ApiCategory): string {
  return CATEGORY_LABELS[category.id] ?? category.category_name
}

// Background of a card without a photo. Undefined for a category missing from
// CATEGORY_TINTS, so the CSS falls back to --brand-soft (see .card-media).
export function categoryTint(category: ApiCategory): string | undefined {
  return CATEGORY_TINTS[category.id]
}

export function conditionLabel(condition: ApiCondition): string {
  return CONDITION_LABELS[condition.id] ?? condition.condition_name
}
