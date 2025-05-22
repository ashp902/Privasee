import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactGA from 'react-ga4';

function OAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      exchangeCodeForTokens(code);
    }
  }, []);

  const exchangeCodeForTokens = async (code) => {
    try {
      const res = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/auth/google/callback`, { code });
      const { access_token, id_token } = res.data;

      if (access_token) {
        localStorage.setItem('accessToken', access_token);
        if (id_token) {
            const base64Payload = id_token.split('.')[1];
            const decoded = JSON.parse(atob(base64Payload));
            const userName = decoded.name || 'User';
            localStorage.setItem('userName', userName);
          }

          ReactGA.event({
            category: 'User',
            action: 'Login Successful'
          });

        navigate('/dashboard');
      } else {
        console.error('No access token returned');
      }
    } catch (error) {
      console.error('Failed to exchange code for token:', error);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center vh-100">
      <h5>Signing you in...</h5>
    </div>
  );
}

export default OAuthCallback;
