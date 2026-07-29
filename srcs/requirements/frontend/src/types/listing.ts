// The shape of a listing. It matches what the backend will return later
// in GET /api/listings — so the page won't change when we swap the mock
// data for a real fetch.
export type Condition = 'novo' | 'como novo' | 'usado' | 'com marcas'

export interface Listing {
  id: string
  title: string
  wants: string
  category: Category
  condition: Condition
  location: string
  owner: string
}

export type Category =
  | 'roupa'
  | 'móveis'
  | 'cartas'
  | 'livros'
  | 'plantas'
  | 'eletrónica'

export const CATEGORIES: Category[] = [
  'roupa', 'móveis', 'cartas', 'livros', 'plantas', 'eletrónica',
]
