// packages/workspace-ref/src/client/main.tsx
// AMEND-nexus-spec-workspace-v1-1-1 §1.1
// Minimal React mount point [OD-WS-003].
// Component internals are NOT spec-governed.
// Must display FinalResponseArtifact as opaque governed artifact [GWS4-AUD-02].

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div>
      <h1>Nexus Workspace</h1>
      <p>Reference workspace UI — governed artifact display surface.</p>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
