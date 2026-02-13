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
  componentDidCatch(error, info) {
    console.error("AURA Error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Helvetica Neue',sans-serif", background: "#FDFCFA" }}>
          <div style={{ textAlign: "center", padding: 40 }}>
            <h1 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, marginBottom: 12 }}>AURA</h1>
            <p style={{ color: "#9B8B7B", marginBottom: 24 }}>Something went wrong, but your selections are saved.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => this.setState({ hasError: false, error: null })} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Try Again</button>
              <button onClick={() => window.location.reload()} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 12, padding: "14px 32px", fontSize: 14, color: "#9B8B7B", cursor: "pointer" }}>Refresh Page</button>
            </div>
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
