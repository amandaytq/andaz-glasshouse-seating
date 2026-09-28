// Top navigation shown on the public pages (guest list). The seating planner
// (/assign-seats) has its own richer toolbar already, so it isn't shown there.
export function NavBar({ navigate, active }) {
  return (
    <nav className="navbar">
      <button className="navbar-brand" onClick={() => navigate('/')}>
        Amanda &amp; Jeremiah
      </button>
      <div className="navbar-links">
        <button
          className={`navbar-link${active === 'guests' ? ' is-active' : ''}`}
          onClick={() => navigate('/')}
        >
          Guest List
        </button>
        <button
          className={`navbar-link${active === 'layout' ? ' is-active' : ''}`}
          onClick={() => navigate('/assign-seats')}
        >
          🔒 Admin
        </button>
      </div>
    </nav>
  )
}
