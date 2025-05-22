import axios from 'axios';

export async function logToCloud({ event, source = 'frontend', data = {} }) {
  try {
    await axios.post(`${process.env.REACT_APP_BACKEND_URL}/log/frontend`, {
      source,
      event,
      data,
    });
  } catch (err) {
    console.error('[Cloud Log] Failed:', err.message);
  }
}
