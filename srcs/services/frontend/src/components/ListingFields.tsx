import type { ApiCategory, ApiCondition } from '../lib/api'
import type { ListingFormErrors, ListingFormValues } from '../lib/listingForm'
import LocationAutocomplete from './LocationAutocomplete'
import { categoryLabel, conditionLabel } from '../types/listing'

type ListingFieldsProps = {
  values: ListingFormValues
  errors: ListingFormErrors
  categories: ApiCategory[]
  conditions: ApiCondition[]
  disabled: boolean
  // Called with the fields that changed, e.g. onChange({ title: 'Bicicleta' }).
  onChange: (changes: Partial<ListingFormValues>) => void
}

// The text fields of a listing, shared by the publish and edit pages. The
// page keeps the values and the errors; this only draws the inputs.
export default function ListingFields({
  values,
  errors,
  categories,
  conditions,
  disabled,
  onChange,
}: ListingFieldsProps) {
  return (
    <>
      {/* Title */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="title" className="text-xs uppercase tracking-wider font-bold text-muted">
            Título do anúncio <span className="text-accent">*</span>
          </label>
          <span className="text-[11px] text-muted">{[...values.title].length}/150</span>
        </div>
        <input
          id="title"
          type="text"
          disabled={disabled}
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Ex.: Bicicleta de montanha em bom estado"
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'title-error' : undefined}
          className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            errors.title ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
          }`}
        />
        {errors.title && (
          <p id="title-error" className="text-xs text-accent mt-1">
            {errors.title}
          </p>
        )}
      </div>

      {/* Category and Condition grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="category" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
            Categoria <span className="text-accent">*</span>
          </label>
          <select
            id="category"
            disabled={disabled}
            value={values.category_id}
            onChange={(e) => onChange({ category_id: e.target.value ? Number(e.target.value) : '' })}
            aria-invalid={Boolean(errors.category_id)}
            aria-describedby={errors.category_id ? 'category-error' : undefined}
            className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              errors.category_id ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
            }`}
          >
            <option value="">Seleciona uma categoria...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {errors.category_id && (
            <p id="category-error" className="text-xs text-accent mt-1">
              {errors.category_id}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="condition" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
            Estado do artigo <span className="text-accent">*</span>
          </label>
          <select
            id="condition"
            disabled={disabled}
            value={values.condition_id}
            onChange={(e) => onChange({ condition_id: e.target.value ? Number(e.target.value) : '' })}
            aria-invalid={Boolean(errors.condition_id)}
            aria-describedby={errors.condition_id ? 'condition-error' : undefined}
            className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              errors.condition_id ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
            }`}
          >
            <option value="">Seleciona o estado...</option>
            {conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {conditionLabel(c)}
              </option>
            ))}
          </select>
          {errors.condition_id && (
            <p id="condition-error" className="text-xs text-accent mt-1">
              {errors.condition_id}
            </p>
          )}
        </div>
      </div>

      {/* Standardized Location Autocomplete */}
      <div>
        <LocationAutocomplete
          id="listing_location"
          label="Localização de preferência"
          value={values.listing_location}
          disabled={disabled}
          placeholder="Escreve uma localidade (ex.: Guimarães, Porto, Lisboa)"
          ariaInvalid={Boolean(errors.listing_location)}
          ariaDescribedBy={errors.listing_location ? 'location-error' : undefined}
          onChange={(val) => onChange({ listing_location: val })}
        />
        {errors.listing_location && (
          <p id="location-error" className="text-xs text-accent mt-1">
            {errors.listing_location}
          </p>
        )}
      </div>

      {/* What you want in return (Wish) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="wish" className="text-xs uppercase tracking-wider font-bold text-muted">
            O que procuras em troca? <span className="text-muted font-normal lowercase">(opcional)</span>
          </label>
          <span className="text-[11px] text-muted">{[...values.wish].length}/1000</span>
        </div>
        <input
          id="wish"
          type="text"
          disabled={disabled}
          value={values.wish}
          onChange={(e) => onChange({ wish: e.target.value })}
          placeholder="Ex.: Livros de ficção científica, jogos de tabuleiro ou material de pintura"
          aria-invalid={Boolean(errors.wish)}
          aria-describedby={errors.wish ? 'wish-error' : undefined}
          className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            errors.wish ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
          }`}
        />
        {errors.wish && (
          <p id="wish-error" className="text-xs text-accent mt-1">
            {errors.wish}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="description" className="text-xs uppercase tracking-wider font-bold text-muted">
            Descrição detalhada <span className="text-muted font-normal lowercase">(opcional)</span>
          </label>
          <span className="text-[11px] text-muted">{[...values.listing_dsc].length}/2000</span>
        </div>
        <textarea
          id="description"
          rows={4}
          disabled={disabled}
          value={values.listing_dsc}
          onChange={(e) => onChange({ listing_dsc: e.target.value })}
          placeholder="Descreve o teu artigo com mais pormenores: tempo de utilização, funcionamento, acessórios incluídos ou pequenas marcas de desgaste."
          aria-invalid={Boolean(errors.listing_dsc)}
          aria-describedby={errors.listing_dsc ? 'description-error' : undefined}
          className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors resize-y disabled:opacity-50 disabled:cursor-not-allowed ${
            errors.listing_dsc ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
          }`}
        />
        {errors.listing_dsc && (
          <p id="description-error" className="text-xs text-accent mt-1">
            {errors.listing_dsc}
          </p>
        )}
      </div>
    </>
  )
}
