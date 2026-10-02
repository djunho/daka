import type { Listing } from '../types/listing'

// Mock data just to render the page while the backend doesn't exist yet.
// Once the backend is ready, delete this and fetch('/api/listings').
export const mockListings: Listing[] = [
  // --- Rita (2 listings) ---
  { id: '1', title: 'Casaco de ganga vintage', wants: 'plantas de interior ou livros', category: 'roupa', condition: 'como novo', location: 'Braga', owner: 'rita' },
  { id: '11', title: 'Botas de caminhada impermeáveis', wants: 'casaco térmico ou luvas', category: 'roupa', condition: 'como novo', location: 'Braga', owner: 'rita' },

  // --- Tiago (11 listings) ---
  { id: '2', title: 'Cadeira de escritório', wants: 'uma secretária pequena', category: 'casa', condition: 'usado', location: 'Guimarães', owner: 'tiago' },
  { id: '12', title: 'Secretária de madeira maciça', wants: 'cadeira ergonómica ou estante', category: 'casa', condition: 'usado', location: 'Guimarães', owner: 'tiago' },
  { id: '13', title: 'Monitor 24 polegadas Full HD', wants: 'teclado mecânico ou colunas', category: 'eletronica', condition: 'como novo', location: 'Guimarães', owner: 'tiago' },
  { id: '14', title: 'Candeeiro articulado de mesa', wants: 'plantas ou outros candeeiros', category: 'casa', condition: 'como novo', location: 'Guimarães', owner: 'tiago' },
  { id: '15', title: 'Rato ergonómico vertical', wants: 'tapete de secretária XL', category: 'eletronica', condition: 'usado', location: 'Guimarães', owner: 'tiago' },
  { id: '16', title: 'Estante modular branca', wants: 'quadros decorativos ou livros', category: 'casa', condition: 'como novo', location: 'Guimarães', owner: 'tiago' },
  { id: '17', title: 'Suporte metálico para portátil', wants: 'hub USB-C ou cabos', category: 'eletronica', condition: 'novo', location: 'Guimarães', owner: 'tiago' },
  { id: '18', title: 'Livro "O Programador Pragmático"', wants: 'outros livros de engenharia', category: 'livros', condition: 'como novo', location: 'Guimarães', owner: 'tiago' },
  { id: '19', title: 'Quadro decorativo geométrico', wants: 'vasos de cerâmica', category: 'casa', condition: 'novo', location: 'Guimarães', owner: 'tiago' },
  { id: '20', title: 'Ficus benjamina em vaso grande', wants: 'outras plantas de sombra', category: 'plantas', condition: 'novo', location: 'Guimarães', owner: 'tiago' },
  { id: '21', title: 'Headphones com cancelamento de ruído', wants: 'coluna bluetooth portátil', category: 'eletronica', condition: 'como novo', location: 'Guimarães', owner: 'tiago' },

  // --- Other users (1 listing each) ---
  { id: '3', title: 'Charizard holográfico', wants: 'outras cartas raras', category: 'colecionaveis', condition: 'novo', location: 'Porto', owner: 'nuno' },
  { id: '4', title: 'Coleção Senhor dos Anéis', wants: 'banda desenhada', category: 'livros', condition: 'com marcas', location: 'Braga', owner: 'sofia' },
  { id: '5', title: 'Monstera enraizada', wants: 'vaso grande ou outras plantas', category: 'plantas', condition: 'novo', location: 'Lisboa', owner: 'ana' },
  { id: '6', title: 'Teclado mecânico', wants: 'rato sem fios ou headset', category: 'eletronica', condition: 'como novo', location: 'Porto', owner: 'joão' },
  { id: '7', title: 'Ténis de corrida nº42', wants: 'mochila de trekking', category: 'roupa', condition: 'usado', location: 'Braga', owner: 'pedro' },
  { id: '8', title: 'Nintendo Switch', wants: 'bicicleta ou monitor', category: 'eletronica', condition: 'como novo', location: 'Lisboa', owner: 'marta' },
  { id: '9', title: 'Candeeiro de pé', wants: 'quadros ou decoração', category: 'casa', condition: 'usado', location: 'Coimbra', owner: 'rui' },
  { id: '10', title: 'Moldura de fotos antiga', wants: 'o que aparecer, faço-me à vida', category: 'outros', condition: 'com marcas', location: 'Aveiro', owner: 'clara' },
]
