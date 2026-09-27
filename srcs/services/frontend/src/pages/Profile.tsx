import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProfileField from '../components/ProfileField'
import Avatar from '../components/Avatar'
import { ApiError } from '../lib/api'

export default function Profile() {
  const { user, updateProfile } = useAuth()

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
      user_name: user?.user_name || '',
      user_location: user?.user_location || '',
      email: user?.email || '',
  })
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFormData({
        user_name: user.user_name,
        user_location: user.user_location || '',
        email: user.email,
      })
    }
  }, [user])

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

  // Cancel: Discard changes by resetting formData to the current user, then exit edit mode
  function handleCancel() {
    if (!user) return

    setFormData({
      user_name: user.user_name,
      user_location: user.user_location || '',
      email: user.email,
    })
    setError(null)
    setIsEditing(false)
  }

  // Save: validate and send the updated data to the backend
  async function handleSave() {
    setError(null)

    // Do some validation
    const trimmedName = formData.user_name.trim()
    const trimmedLocation = formData.user_location.trim()

    if (trimmedName.length < 2) {
      setError('O nome de utilizador deve ter pelo menos 2 caracteres visíveis.')
      return
    }

    // 100 is defined on backend (database)
    if (trimmedName.length > 100) {
      setError('O nome de utilizador não pode ter mais de 100 caracteres.')
      return
    }

    if (trimmedLocation.length > 100) {
      setError('A localização não pode ter mais de 100 caracteres.')
      return
    }

    // Check if some change was made
    const hasNameChanged = trimmedName !== user?.user_name
    const hasLocationChanged = (trimmedLocation || null) !== (user?.user_location || null)

    if (!hasNameChanged && !hasLocationChanged) {
      setIsEditing(false)
      return
    }

    setSaving(true)
    try {
      await updateProfile({
        user_name: trimmedName,
        user_location: trimmedLocation || null,
        // TODO: Add avatar when enabled
      })
      setIsEditing(false)
    } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erro desconhecido ao guardar alterações. Por favor, tente novamente.')
    } finally {
        setSaving(false)
    }
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      {/* Error Banner if exists */}
      { error && 
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 bg-surface border border-accent/40 text-accent px-4 py-3 rounded-xl shadow-xl max-w-sm" role="alert">
          <span className="block sm:inline">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-muted hover:text-ink text-xs font-bold p-1 ml-auto transition-colors"
            aria-label="Fechar alerta"
          >
            ✕
          </button>
        </div>
      }
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
                  disabled={saving}
                  onClick={handleCancel}
                  className={"text-xs font-medium text-muted hover:text-ink px-2.5 py-1 rounded-lg transition-colors" +
                            " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted"}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={"text-xs font-semibold bg-brand text-surface px-3 py-1.5 rounded-lg hover:opacity-95 transition-opacity" +
                            " disabled:opacity-40 disabled:cursor-not-allowed"}
                >
                  {saving ? 'A guardar...' : 'Guardar alterações'}
                </button>
              </div>
            )}
          </div>

          {/* Name Field */}
          <ProfileField
            id="user_name"
            label="Nome de utilizador"
            value={formData.user_name}
            readOnly={!isEditing || saving}
            onChange={(e) => setFormData({ ...formData, user_name: e.target.value })}
          />

          {/* Email Field */}
          <ProfileField
            id="email"
            label="Email"
            value={formData.email}
            //readOnly={!isEditing || saving}
            readOnly={true} // Email is not editable for now
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />

          {/* Location Field */}
          <ProfileField
            id="user_location"
            label="Localização"
            value={formData.user_location || ''}
            placeholder="Sem localização definida"
            readOnly={!isEditing || saving}
            onChange={(e) => setFormData({ ...formData, user_location: e.target.value })}
          />
        </div>
        <Link className="btn" to="/">Voltar ao início</Link>
      </div>
    </main>
  )
}
