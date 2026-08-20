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
