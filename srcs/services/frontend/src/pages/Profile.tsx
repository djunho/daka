import { useState } from 'react'
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

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
      user_name: user.user_name,
      user_location: user.user_location || '',
      email: user.email,
  })

  // Format date: "setembro de 2026"
  const memberSince = new Date(user.created_at).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  })

  // Cancel: Discard changes by resetting formData to the current user, then exit edit mode
  function handleCancel() {
    if (!user) return

    setFormData({
      user_name: user.user_name,
      user_location: user.user_location || '',
      email: user.email,
    })
    setIsEditing(false)
  }

  // Save: validate and send the updated data to the backend (not implemented yet)
  function handleSave() {
    setIsEditing(false)
    alert('Funcionalidade de guardar ainda não implementada. (Simulação concluída.)')
  }

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

            {!isEditing ? (
              <button
                type="button"
                className="text-xs font-semibold text-brand hover:underline"
                onClick={() => setIsEditing(true)}
              >
                Editar perfil
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="text-xs font-medium text-muted hover:text-ink px-2.5 py-1 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="text-xs font-semibold bg-brand text-surface px-3 py-1.5 rounded-lg hover:opacity-95 transition-opacity"
                >
                  Guardar alterações
                </button>
              </div>
            )}
          </div>

          {/* Name Field */}
          <ProfileField
            id="user_name"
            label="Nome de utilizador"
            value={formData.user_name}
            readOnly={!isEditing}
            onChange={(e) => setFormData({ ...formData, user_name: e.target.value })}
          />

          {/* Email Field */}
          <ProfileField
            id="email"
            label="Email"
            value={formData.email}
            readOnly={!isEditing}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />

          {/* Location Field */}
          <ProfileField
            id="user_location"
            label="Localização"
            value={formData.user_location || ''}
            placeholder="Sem localização definida"
            readOnly={!isEditing}
            onChange={(e) => setFormData({ ...formData, user_location: e.target.value })}
          />
        </div>
        <Link className="btn" to="/">Voltar ao início</Link>
      </div>
    </main>
  )
}
