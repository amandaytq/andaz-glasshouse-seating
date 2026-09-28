// Small reusable "are you sure?" modal — same overlay/backdrop pattern as
// password-gate.jsx, kept separate since this one is dismissible (click the
// backdrop or Cancel) while the password gate deliberately isn't.
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <strong>{title}</strong>
        {message && <p className="field-hint">{message}</p>}
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'danger' : ''} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
