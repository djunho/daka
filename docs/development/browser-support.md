# Browser Support (Chrome, Firefox & Edge)

How Daka is verified across multiple browsers for the **Minor module "Support for additional browsers" (1 pt)** (`en.subject.pdf`, Section IV.2).

---

## 1. Supported Browsers

| Browser | Role | Engine | Minimum | Tested (`Linux x86_64`) | Console |
| --- | --- | --- | :---: | --- | :---: |
| **Google Chrome** | Mandatory baseline | Blink / V8 | **111+** | `155.0.8059.84` | `0` errors / `0` warnings |
| **Mozilla Firefox** | Additional #1 | Gecko / SpiderMonkey | **128+** | `158.0.1` | `0` errors / `0` warnings |
| **Microsoft Edge** | Additional #2 | Blink / V8 | **111+** | `157.0.4341.42` | `0` errors / `0` warnings |

**Why `111+` / `128+`:** Tailwind CSS v4 requires native `@layer`, `@property`, and `color-mix()`, and [`index.css`](../../srcs/services/frontend/src/index.css) uses `html:has(dialog[open])` and `scrollbar-gutter: stable`.

---

## 2. Compatibility Matrix (by Page, Menu & Widget)

Verified on `2026-11-07` by Daniel Junho (`djunho`). `✅` = consistent UI/UX and zero console errors/warnings. Side-by-side visual report: [`browser-support.html`](browser-support.html).

| Page / Feature / Widget / Menu | Chrome | Firefox | Edge | Verified behavior |
| --- | :---: | :---: | :---: | --- |
| **Home (`/`) & Search** | ✅ | ✅ | ✅ | Text search (`q`), location filter, sort `<select>`, pagination, and URL filter persistence on reload |
| **Header Account Menu (`UserMenu`)** | ✅ | ✅ | ✅ | Avatar dropdown (*Perfil, Meus anúncios, Negociações, Amigos, Encerrar sessão*), outside-click & `Escape` close |
| **Mobile Layout (`375px`) & `CategoryChips`** | ✅ | ✅ | ✅ | Zero horizontal overflow (`375px` / `768px` / `1440px`); `ResizeObserver` collapses chips into *"Ver todas"* |
| **Login & Registration (`/login`)** | ✅ | ✅ | ✅ | PT-PT validation, session cookie, cross-tab logout, single password eye toggle (Edge `::-ms-reveal` hidden) |
| **Google OAuth 2.0** | ✅ | ✅ | ✅ | Standard HTTPS OAuth 2.0 redirect flow and callback session cookie ([guide](google-authentication.md)) |
| **Listing Detail (`/listing/:id`) & PDF Viewer** | ✅ | ✅ | ✅ | Photo gallery, owner card, and inline PDF opening (Firefox PDF.js / Chrome PDF viewer) |
| **Publish & Edit Listing (`/publish`, `/listing/:id/edit`)** | ✅ | ✅ | ✅ | Up to 6 photos + 3 PDFs, client/server validation, `UploadProgress` bar, cover selection & deletion |
| **Profile (`/profile`) & `LocationAutocomplete`** | ✅ | ✅ | ✅ | Avatar upload/remove, lazy-loaded Portugal dataset, ARIA combobox (`ArrowUp`/`Down`, `Enter`, `Escape`) |
| **Confirmation Modal (`ConfirmDialog`)** | ✅ | ✅ | ✅ | Native `<dialog>` `.showModal()`, focus trap, `Escape` close, and `::backdrop` |
| **Public Profile (`/users/:id`) & Friends (`/friends`)** | ✅ | ✅ | ✅ | Add/remove friend, pagination, `OnlineBadge` presence & tab-visibility refresh |
| **Negotiations (`/negotiations`) & `NegotiationsDock`** | ✅ | ✅ | ✅ | Role/state filters, floating dock badge, active cards, 1-click chat launch |
| **Negotiation Detail & Live Chat (`NegotiationChatWidget`)** | ✅ | ✅ | ✅ | Propose/withdraw/reopen/accept/reject/cancel/complete; live `wss://` chat (**Firefox ↔ Edge**), 250-char limit & offline reconnect |
| **Design System (`/design-system`), Legal & 404** | ✅ | ✅ | ✅ | `Fraunces` & `Outfit` webfonts, WCAG AA tokens, `/privacy`, `/terms`, and custom 404 |

---

## 3. Fix Applied

- **Microsoft Edge duplicate password-reveal icon (`/login`):** Edge injected its native `::-ms-reveal` eye button right next to Daka's custom toggle in [`Login.tsx`](../../srcs/services/frontend/src/pages/Login.tsx). Fixed in [`srcs/services/frontend/src/index.css`](../../srcs/services/frontend/src/index.css) (`@layer base`):
  ```css
  input::-ms-reveal,
  input::-ms-clear {
    display: none;
  }
  ```

---

## 4. Known Browser-Specific Limitations

1. **Apple Safari is out of scope:** Development and evaluation run on Linux (`x86_64`), where Safari is unavailable (Linux WebKit builds do not match macOS/iOS Safari).
2. **Self-signed local TLS certificate (`https://localhost:8443`):** Firefox uses its own NSS certificate store (*Advanced → Accept the Risk and Continue*), separate from the OS store used by Chrome and Edge. Accepting the certificate in each browser is required before `wss://` WebSockets connect.
3. **Engine coverage:** Chrome and Edge share Blink/V8 (with Edge-specific UI overlays like `::-ms-reveal`), while Firefox runs Gecko/SpiderMonkey.
4. **Native browser chrome:** Opened `<select>` popups, file pickers, autofill highlights, `input[type="search"]` clear icons, and built-in PDF viewer toolbars follow each browser's native UI without affecting layout or contrast.

---

## 5. Quick Verification (Firefox ↔ Edge Side-by-Side)

1. Run `make`, open `https://localhost:8443` in **Firefox** (User A) and **Edge** (User B), accept the local certificate, and keep **DevTools → Console** (*Errors + Warnings*, *Preserve log*) open in both.
2. Check `/login` password field in Edge (single eye icon), sign in on both browsers, and publish a listing with a photo and PDF in Firefox.
3. In Edge, find the listing via search/category filter, add User A as a friend on `/users/:id`, and click **Iniciar negociação**.
4. Open the chat widget in both browsers, send messages both ways (`Firefox ↔ Edge`), toggle **Network → Offline → Online** in one browser to verify automatic reconnection, and confirm `0` console errors/warnings in both.
