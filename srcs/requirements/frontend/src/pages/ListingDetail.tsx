import { useParams, Link } from 'react-router-dom'
import { mockListings } from '../data/mockListings'
import { CATEGORY_BY_ID } from '../types/listing'

// useParams reads the :id piece from the URL (/listing/3 -> id === "3").
// This is the router feature that lets one component serve many listings.
export default function ListingDetail() {
  const { id } = useParams()
  const listing = mockListings.find((l) => l.id === id)

  if (!listing) {
    return (
      <main className="page">
        <h1 className="page-title">Anúncio não encontrado</h1>
        <p className="page-text">Não há nenhum anúncio com o id {id}.</p>
        <Link className="btn" to="/">Voltar ao início</Link>
      </main>
    )
  }

  return (
    <main className="page">
      <h1 className="page-title">{listing.title}</h1>
      <p className="page-text">
        <span className="swap-arrow" aria-hidden="true">⇄</span>{' '}
        quer: <strong>{listing.wants}</strong>
      </p>
      <p className="page-text">
        {CATEGORY_BY_ID[listing.category].label} · {listing.condition} ·{' '}
        {listing.location} · @{listing.owner}
      </p>
      <p className="page-text">
        (Página de detalhe em construção — o botão de propor troca entra aqui.)
      </p>
      <Link className="btn" to="/">Voltar ao início</Link>
    </main>
  )
}
