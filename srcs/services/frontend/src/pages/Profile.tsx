import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProfileField from '../components/ProfileField'
import LocationAutocomplete from '../components/LocationAutocomplete'
import Avatar from '../components/Avatar'
import Button, { buttonClasses } from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import ImagePicker from '../components/ImagePicker'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { ApiError } from '../lib/api'

export default function Profile() {
  const { user, updateProfile, uploadAvatar, removeAvatar, deleteAccount } = useAuth()

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
      user_name: user?.user_name || '',
      user_location: user?.user_location || '',
      email: user?.email || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Avatar changes wait here while editing and are only sent by "Guardar
  // alterações", together with the other fields. avatarFile is a new photo
  // (shown as a preview); avatarRemoved means "go back to the initial".
  // Hooks stay above the early return (Rules of Hooks).
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const avatarPreview = useObjectUrl(avatarFile)

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
          <main className="max-w-[720px] mx-auto px-6 py-12">
          <h1 className="font-display font-bold tracking-tight text-[32px] mb-4">Erro ao carregar dados do utilizador</h1>
          <Link className={buttonClasses()} to="/">Voltar ao início</Link>
          </main>
      )
  }

  // What the avatar circle currently shows: a picked photo, or the saved one
  // unless it was marked for removal.
  const showsAvatar = avatarFile !== null || (!avatarRemoved && !!user.avatar)

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
    setAvatarFile(null)
    setAvatarRemoved(false)
    setError(null)
    setIsEditing(false)
  }

  // Save: validate and send the updated data to the backend
  async function handleSave() {
    setError(null)

    // Trim values and count Unicode code points to match Python's len() in backend
    const trimmedName = formData.user_name.trim()
    const trimmedLocation = formData.user_location.trim()
    const nameLength = [...trimmedName].length
    const locationLength = [...trimmedLocation].length

    if (nameLength < 2) {
      setError('O nome de utilizador deve ter pelo menos 2 caracteres visíveis.')
      return
    }

    // 100 is defined on backend (database)
    if (nameLength > 100) {
      setError('O nome de utilizador não pode ter mais de 100 caracteres.')
      return
    }

    if (locationLength > 100) {
      setError('A localização não pode ter mais de 100 caracteres.')
      return
    }

    // Check if some change was made
    const hasNameChanged = trimmedName !== user?.user_name
    const hasLocationChanged = (trimmedLocation || null) !== (user?.user_location || null)
    // Removing only counts if there is a saved avatar to remove.
    const removeSavedAvatar = avatarRemoved && !!user?.avatar
    const hasAvatarChanged = avatarFile !== null || removeSavedAvatar

    if (!hasNameChanged && !hasLocationChanged && !hasAvatarChanged) {
      handleCancel()
      return
    }

    setSaving(true)
    try {
      // Name and location first. If the photo then fails, the fields are
      // already saved and pressing "Guardar" again only retries the photo.
      if (hasNameChanged || hasLocationChanged) {
        await updateProfile({
          user_name: trimmedName,
          user_location: trimmedLocation || null,
        })
      }
      if (avatarFile) {
        await uploadAvatar(avatarFile)
      } else if (removeSavedAvatar) {
        await removeAvatar()
      }
      setAvatarFile(null)
      setAvatarRemoved(false)
      setIsEditing(false)
    } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erro desconhecido ao guardar alterações. Por favor, tente novamente.')
    } finally {
        setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setError(null)
    setDeleting(true)
    try {
      await deleteAccount()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Erro desconhecido. Não foi possível eliminar a conta. Por favor, tenta novamente.'
      )
      setDeleting(false)
      setShowDeleteModal(false)
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
            avatar={avatarPreview ?? (avatarRemoved ? null : user.avatar)}
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

            {/* Avatar actions, only while editing. They change the preview;
                "Guardar alterações" is what sends them. */}
            {isEditing && (
              <div className="flex items-center gap-2 mt-2">
                <ImagePicker
                  label={showsAvatar ? 'Alterar foto' : 'Adicionar foto'}
                  onPick={(file) => {
                    setError(null)
                    setAvatarFile(file)
                    setAvatarRemoved(false)
                  }}
                  onError={setError}
                  disabled={saving}
                />
                {showsAvatar && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarFile(null)
                      setAvatarRemoved(true)
                    }}
                    disabled={saving}
                    className={"text-xs font-medium text-muted hover:text-ink px-2.5 py-1 rounded-lg transition-colors" +
                              " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted"}
                  >
                    Remover foto
                  </button>
                )}
              </div>
            )}
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
                <Button variant="ghost" size="sm" disabled={saving} onClick={handleCancel}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
                  {saving ? 'A guardar...' : 'Guardar alterações'}
                </Button>
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

          {/* Location Field with Autocomplete */}
          <LocationAutocomplete
            id="user_location"
            label="Localização"
            value={formData.user_location || ''}
            placeholder={isEditing ? 'Escreva a sua localidade (ex.: Guimarães, Porto, Lisboa)' : 'Sem localização definida'}
            readOnly={!isEditing}
            disabled={saving}
            // Spread operator preserves other form fields (user_name, email) while updating location
            onChange={(val) => setFormData({ ...formData, user_location: val })}
          />
        </div>

        {/* --- Danger Zone (Account Deletion) --- */}
        <div className="pt-6 border-t border-line">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-accent/20 bg-accent/[0.02]">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-accent">
                Zona de perigo
              </h3>
              <p className="text-xs text-muted mt-1">
                Ao eliminares a tua conta, todos os teus anúncios e propostas de troca serão cancelados de forma definitiva.
              </p>
            </div>
            <Button
              variant="dangerOutline"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              disabled={isEditing || saving || deleting}
              className="whitespace-nowrap self-start sm:self-auto"
            >
              Eliminar conta
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <Link className={buttonClasses()} to="/">Voltar ao início</Link>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteModal}
        title="Eliminar conta"
        message="Tens a certeza de que desejas eliminar a tua conta? Esta ação é irreversível. Todos os teus anúncios serão removidos e as tuas propostas de troca ativas serão canceladas."
        confirmLabel="Sim, eliminar conta"
        busyLabel="A eliminar..."
        busy={deleting}
        onConfirm={handleDeleteAccount}
        onCancel={() => setShowDeleteModal(false)}
      />
    </main>
  )
}
