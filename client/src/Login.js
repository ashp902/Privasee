import { useNavigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import ReactGA from 'react-ga4';

function Login() {
  const navigate = useNavigate();

  const handleGoogleLogin = () => {
    ReactGA.event({
        category: 'User',
        action: 'Initiated Login',
        label: 'Connect Google Button'
      });
    console.log(process.env.REACT_APP_BACKEND_URL);
    window.location.href = `${process.env.REACT_APP_BACKEND_URL}/auth/google`;
  };

  return (
    <div className="d-flex flex-column justify-content-center align-items-center vh-100">
      <div className="text-center mb-4">
        <img src="/privasee-logo.png" alt="Privasee Logo" style={{ width: "80px", marginBottom: "10px" }} />
        <h2 className="fw-bold">privasee</h2>
      </div>

      <div className="card p-5 shadow-sm" style={{ width: "400px", maxWidth: "90%" }}>
        <div className="card-body text-center">
          <h3 className="card-title fw-bold mb-3">Get Started with privasee</h3>
          <p className="card-text mb-4" style={{ fontSize: "15px", color: "#555" }}>
            Connect your Google Account to see which photos of yours are at risk of information theft and easily secure them.
          </p>

          <button
            className="btn btn-primary w-100"
            style={{ fontSize: "16px", padding: "10px" }}
            onClick={handleGoogleLogin}
          >
            Connect your Google Account
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;
