import { Link } from 'react-router-dom'
import Logo from './Logo'

// Reusable header. <Link> changes the page without a full reload — that's the
// whole point of the router. A plain <a> would reload and lose that.
export default function Header() {
  return (
    <header className="app-header">
      <Link className="brand" to="/" aria-label="Daka — página inicial">
        <Logo height={34} />
      </Link>
      <input
        className="search"
        type="search"
        placeholder="Procurar o que trocar…"
        aria-label="Procurar anúncios"
      />
      <div className="header-actions">
        <Link className="btn" to="/login">Entrar</Link>
        <Link className="btn btn-primary" to="/login">Publicar</Link>
      </div>
    </header>
  )
}
