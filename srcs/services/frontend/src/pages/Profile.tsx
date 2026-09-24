import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProfileField from '../components/ProfileField'
import Avatar from '../components/Avatar'

export default function Profile() {
  const { user } = useAuth()

  if (!user) {
    return (
      <main className="page">
        <h1 className="page-title">Erro ao carregar dados do utilizador</h1>
        <Link className="btn" to="/">Voltar ao início</Link>
      </main>
    )
  }

  // Format date: "setembro de 2026"
  const memberSince = new Date(user.created_at).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4 pb-6 border-b border-line">
          <Avatar
            avatar={user.avatar}
            user_name={user.user_name}
          />

          {/* User Name & Subtitle */}
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              {user.user_name}
            </h1>
            <p className="text-sm text-muted">
              Membro desde {memberSince}
            </p>
          </div>
        </div>


        {/* --- User Details (Form Fields) --- */}
        <div className="py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider font-bold text-muted">
              Dados da conta
            </h2>

            {/* TODO: Implement this future Edit Button */}
            <button
              type="button"
              className="text-xs font-semibold text-brand hover:underline"
              onClick={() => alert('Edição a implementar')}
            >
              Editar perfil
            </button>
          </div>

          {/* Name Field */}
          <ProfileField
            id="user_name"
            label="Nome de utilizador"
            value={user.user_name}
          />

          {/* Email Field */}
          <ProfileField
            id="email"
            label="Email"
            value={user.email}
          />

          {/* Location Field */}
          <ProfileField
            id="user_location"
            label="Localização"
            value={user.user_location || ''}
            placeholder="Sem localização definida"
          />
        </div>
        <Link className="btn" to="/">Voltar ao início</Link>
      </div>
    </main>
  )
}
