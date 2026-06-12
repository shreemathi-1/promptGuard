import NavBar from './NavBar';

export default function Layout({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavBar />
      <main style={{
        flex:       1,
        padding:    '32px 24px',
        maxWidth:   960,
        width:      '100%',
        margin:     '0 auto',
      }}>
        {children}
      </main>
    </div>
  );
}