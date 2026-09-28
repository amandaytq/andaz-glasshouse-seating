import { useState } from 'react'

// Client-side gate — the password lives in the shipped JS bundle, so this
// only deters casual visitors from the editing tool, not a real access
// control (there's no server-side check on /api/layout or /api/guests).
// Once unlocked, the pass stays remembered on this device via localStorage.
//
// A real modal overlay (fixed backdrop + floating card), not a full page —
// `children` only mount once unlocked (the gate is meant to keep casual
// visitors from seeing the layout at all, not just from editing it).
export function PasswordGate({ password, storageKey, children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)

  if (unlocked) return children

  const submit = (e) => {
    e.preventDefault()
    if (input === password) {
      try {
        localStorage.setItem(storageKey, 'true')
      } catch {
        /* ignore */
      }
      setUnlocked(true)
    } else {
      setError(true)
      setInput('')
    }
  }

  return (
    <div className="pwgate-overlay">
      <form className="pwgate-card" onSubmit={submit}>
        <strong>Amanda &amp; Jeremiah — Admin</strong>
        <p className="field-hint">This page is password-protected.</p>
        <input
          className={`pwgate-input${error ? ' is-error' : ''}`}
          type="password"
          autoFocus
          placeholder="Password"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(false)
          }}
        />
        {error && <p className="pwgate-error">Incorrect password.</p>}
        <button type="submit">Unlock</button>
      </form>
    </div>
  )
}
