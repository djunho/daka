import type { ApiCategory, ApiCondition } from '../lib/api'

// The shape of a listing. It matches what the backend will return later
// in GET /api/listings — so the page won't change when we swap the mock
// data for a real fetch.
export type Condition = 'novo' | 'como novo' | 'usado' | 'com marcas'

// A category id is the short, stable code we store and compare in code
// (no spaces, no accents). The human-facing name lives in CATEGORIES below.
export type CategoryId =
  | 'roupa'
  | 'eletronica'
  | 'casa'
  | 'livros'
  | 'plantas'
  | 'colecionaveis'
  | 'outros'

export interface Listing {
  id: string
  title: string        // what the person HAS
  wants: string        // what the person WANTS
  category: CategoryId
  condition: Condition
  location: string
  owner: string        // username of who posted it
}

// One entry per category: the code id, the label shown in the UI, and a
// short hint describing what fits in it.
export interface Category {
  id: CategoryId
  label: string
  hint: string
}

export const CATEGORIES: Category[] = [
  { id: 'roupa',         label: 'Roupa & Acessórios', hint: 'roupa, calçado, joias' },
  { id: 'eletronica',    label: 'Eletrónicos',        hint: 'portáteis, consolas, gadgets' },
  { id: 'casa',          label: 'Casa & Móveis',      hint: 'mobiliário, decoração, utensílios' },
  { id: 'livros',        label: 'Livros & Jogos',     hint: 'livros, board games, videojogos' },
  { id: 'plantas',       label: 'Plantas & Jardim',   hint: 'plantas, vasos, sementes' },
  { id: 'colecionaveis', label: 'Colecionáveis',      hint: 'cartas, figuras, moedas, selos' },
  { id: 'outros',        label: 'Outros',             hint: 'tudo o resto' },
]

// Quick lookup by id — handy for showing a category's label from a listing.
export const CATEGORY_BY_ID: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>

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
