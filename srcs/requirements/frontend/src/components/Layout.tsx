import { Outlet, Link } from 'react-router-dom'
import Header from './Header'

// Shared shell: Header on top, the current page in the middle (<Outlet/>),
// and a footer with the legally-required links reachable from every page.
export default function Layout() {
  return (
    <>
      <Header />
      <Outlet />
      <footer className="app-footer">
        <Link to="/privacy">Privacidade</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms">Termos</Link>
      </footer>
    </>
  )
}
