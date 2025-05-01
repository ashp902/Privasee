import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';
import OAuthCallback from './OAuthCallback';
import ReactGA from 'react-ga4';
import { useEffect } from 'react';

ReactGA.initialize('G-1W55QDTWWS'); 

function RouteTracker() {
  const location = useLocation();

  useEffect(() => {
    ReactGA.send({ hitType: 'pageview', page: location.pathname });
  }, [location]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/auth/google/callback" element={<OAuthCallback />} /> 
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
