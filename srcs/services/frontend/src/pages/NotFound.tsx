import { Link } from 'react-router-dom'

// Shown for any URL that matched no route (the path="*" in App.tsx).
export default function NotFound() {
  return (
    <main className="page">
      <h1 className="page-title">404 — página não encontrada</h1>
      <p className="page-text">Este endereço não existe no Daka.</p>
      <Link className="btn" to="/">Voltar ao início</Link>
    </main>
  )
}
