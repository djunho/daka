// Static data for the /design-system page. Nothing here comes from the API:
// the page must work for visitors, never call the backend and never produce a
// request that fails (which would print an error in the browser console).

import { type ApiCategory, type ApiListingSummary } from '../lib/api'

// --- Colors ---------------------------------------------------------------

export type ColorToken = {
  token: string
  use: string
  // Text colors show their contrast on the two page backgrounds.
  text?: boolean
}

export type ColorGroup = { title: string; tokens: ColorToken[] }

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: 'Marca',
    tokens: [
      { token: '--color-brand', use: 'Botões principais, fundo do logo, o lado "tem" de uma troca', text: true },
      { token: '--color-brand-soft', use: 'Chip de categoria ativo, fundo de foto em falta' },
      { token: '--color-accent', use: 'O lado "quer" de uma troca, ações destrutivas, erros', text: true },
      { token: '--color-logo-accent', use: 'Só a seta vermelha do logo (gráfico, nunca texto)' },
    ],
  },
  {
    title: 'Superfícies',
    tokens: [
      { token: '--color-paper', use: 'Fundo da página' },
      { token: '--color-surface', use: 'Cartões, cabeçalho, campos de formulário' },
      { token: '--color-line', use: 'Bordas e separadores' },
    ],
  },
  {
    title: 'Texto',
    tokens: [
      { token: '--color-ink', use: 'Texto principal e títulos', text: true },
      { token: '--color-muted', use: 'Texto secundário e placeholders', text: true },
      { token: '--color-label', use: 'Etiquetas de categoria, opções não selecionadas', text: true },
    ],
  },
  {
    title: 'Estado',
    tokens: [
      { token: '--color-online', use: 'Ponto "Online" do OnlineBadge' },
      { token: '--color-offline', use: 'Ponto "Offline" do OnlineBadge' },
    ],
  },
]

// --- Typography -------------------------------------------------------------

export const DISPLAY_SAMPLES = [
  { className: 'text-4xl', label: 'text-4xl · 36 px', text: 'Troca o que tens' },
  { className: 'text-3xl', label: 'text-3xl · 30 px', text: 'Pelo que procuras' },
  { className: 'text-2xl', label: 'text-2xl · 24 px', text: 'Anúncios perto de ti' },
]

export const SANS_SAMPLES = [
  { className: 'text-base', label: 'text-base · 16 px', text: 'Texto corrido de páginas e formulários.' },
  { className: 'text-sm', label: 'text-sm · 14 px', text: 'Texto de cartões, botões e listas.' },
  { className: 'text-xs', label: 'text-xs · 12 px', text: 'Etiquetas, metadados e ajudas.' },
]

export const WEIGHT_SAMPLES = [
  { className: 'font-normal', label: '400 · normal' },
  { className: 'font-medium', label: '500 · medium' },
  { className: 'font-semibold', label: '600 · semibold' },
  { className: 'font-bold', label: '700 · bold' },
]

// --- Components -------------------------------------------------------------

export const SAMPLE_CATEGORIES: ApiCategory[] = [
  { id: 1, category_name: 'Books' },
  { id: 2, category_name: 'Clothing' },
  { id: 5, category_name: 'Electronics' },
  { id: 6, category_name: 'Games' },
  { id: 11, category_name: 'Tools' },
]

const SAMPLE_OWNER = {
  id: 1,
  user_name: 'ana',
  avatar: null,
  user_location: 'Porto',
  is_online: true,
}

export const SAMPLE_LISTINGS: ApiListingSummary[] = [
  {
    id: 1,
    title: 'Coleção de livros de ficção científica',
    category: { id: 1, category_name: 'Books' },
    condition: { id: 3, condition_name: 'Good' },
    listing_location: 'Porto',
    wish: 'Jogos de tabuleiro',
    owner: SAMPLE_OWNER,
    cover_image: null,
    created_at: '2026-11-01T10:00:00Z',
  },
  {
    id: 2,
    title: 'Berbequim sem fios',
    category: { id: 11, category_name: 'Tools' },
    condition: { id: 2, condition_name: 'Like New' },
    listing_location: 'Braga',
    wish: 'Bicicleta de criança',
    owner: { ...SAMPLE_OWNER, id: 2, user_name: 'rui' },
    cover_image: null,
    created_at: '2026-11-02T10:00:00Z',
  },
]
