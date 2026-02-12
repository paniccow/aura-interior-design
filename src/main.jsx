import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Helvetica Neue',sans-serif", background: "#FDFCFA" }}>
          <div style={{ textAlign: "center", padding: 40 }}>
            <h1 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, marginBottom: 12 }}>AURA</h1>
            <p style={{ color: "#9B8B7B", marginBottom: 24 }}>Something went wrong. Please refresh.</p>
            <button onClick={() => window.location.reload()} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Refresh</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
