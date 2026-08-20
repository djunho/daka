import type { Listing } from '../types/listing'

// Mock data just to render the page while the backend doesn't exist yet.
// Once the backend is ready, delete this and fetch('/api/listings').
export const mockListings: Listing[] = [
  { id: '1', title: 'Casaco de ganga vintage', wants: 'plantas de interior ou livros', category: 'roupa', condition: 'como novo', location: 'Braga', owner: 'rita' },
  { id: '2', title: 'Cadeira de escritório', wants: 'uma secretária pequena', category: 'casa', condition: 'usado', location: 'Guimarães', owner: 'tiago' },
  { id: '3', title: 'Charizard holográfico', wants: 'outras cartas raras', category: 'colecionaveis', condition: 'novo', location: 'Porto', owner: 'nuno' },
  { id: '4', title: 'Coleção Senhor dos Anéis', wants: 'banda desenhada', category: 'livros', condition: 'com marcas', location: 'Braga', owner: 'sofia' },
  { id: '5', title: 'Monstera enraizada', wants: 'vaso grande ou outras plantas', category: 'plantas', condition: 'novo', location: 'Lisboa', owner: 'ana' },
  { id: '6', title: 'Teclado mecânico', wants: 'rato sem fios ou headset', category: 'eletronica', condition: 'como novo', location: 'Porto', owner: 'joão' },
  { id: '7', title: 'Ténis de corrida nº42', wants: 'mochila de trekking', category: 'roupa', condition: 'usado', location: 'Braga', owner: 'pedro' },
  { id: '8', title: 'Nintendo Switch', wants: 'bicicleta ou monitor', category: 'eletronica', condition: 'como novo', location: 'Lisboa', owner: 'marta' },
  { id: '9', title: 'Candeeiro de pé', wants: 'quadros ou decoração', category: 'casa', condition: 'usado', location: 'Coimbra', owner: 'rui' },
  { id: '10', title: 'Moldura de fotos antiga', wants: 'o que aparecer, faço-me à vida', category: 'outros', condition: 'com marcas', location: 'Aveiro', owner: 'clara' },
]
