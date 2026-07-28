import Logo from './Logo'

// Reusable header. The buttons are stubs for now — they wire up to nothing
// until we have authentication and the "publish" page.
export default function Header() {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Daka — página inicial">
        <Logo height={34} />
      </a>
      <input
        className="search"
        type="search"
        placeholder="Procurar o que trocar…"
        aria-label="Procurar anúncios"
      />
      <div className="header-actions">
        <button className="btn">Entrar</button>
        <button className="btn btn-primary">Publicar</button>
      </div>
    </header>
  )
}
