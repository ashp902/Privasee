import { useEffect, useState } from 'react';
import axios from 'axios';
import 'bootstrap/dist/css/bootstrap.min.css';
import ReactGA from 'react-ga4';
import { logToCloud } from './utils/logToCloud';

function Dashboard() {
  const [imagesWithText, setImagesWithText] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  const username = localStorage.getItem("userName") || "User"; // fallback

  useEffect(() => {
    fetchPhotos();
  }, []);

  const fetchPhotos = async () => {
    const token = localStorage.getItem('accessToken');

    if (!token) {
      console.error('No access token found');
      return;
    }

    setLoading(true);

    let allPhotos = [];
    let nextPageToken = null;

    try {
      do {
        const res = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
          headers: { Authorization: `Bearer ${token}` },
          params: nextPageToken ? { pageToken: nextPageToken } : {},
        });

        if (res.data && res.data.mediaItems) {
          const onlyPhotos = res.data.mediaItems.filter(item => {
            return item.mimeType && item.mimeType.startsWith('image/');
          });
          allPhotos = allPhotos.concat(onlyPhotos);
        }

        nextPageToken = res.data.nextPageToken;
      } while (nextPageToken && allPhotos.length < 500);

      const markedRes = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/get-marked-images`);
      const markedImageIds = markedRes.data.marked || [];

      const unmarkedPhotos = allPhotos.filter(photo => !markedImageIds.includes(photo.id));
      const sensitiveImages = [];

      for (let photo of unmarkedPhotos) {
        if (sensitiveImages.length >= 20) break;

        try {
          const ocrRes = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/ocr`, {
            imageUrl: photo.baseUrl,
          });

          const fullText = ocrRes.data.fullText?.trim();
          const sensitiveWords = ocrRes.data.sensitiveWords || [];

          if (!fullText) continue;

          const geminiRes = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/checkSensitiveText`, {
            text: fullText,
          });

          const { type, value } = geminiRes.data;

          if (type !== 'Not Sensitive' && value.trim() !== '') {
            sensitiveImages.push({
              ...photo,
              tag: type,
              sensitiveValue: value,
              sensitiveWords,
            });
          }
        } catch (error) {
          console.error('OCR or PII detection failed:', error);
        }
      }

      setImagesWithText(sensitiveImages);

      ReactGA.event({
        category: 'Image',
        action: 'Fetched Google Photos',
        label: 'MediaItems API'
      });
    } catch (error) {
      console.error('Failed to fetch photos', error);
    } finally {
      setLoading(false);
    }
  };

  const openModal = (img) => setSelectedImage(img);
  const closeModal = () => setSelectedImage(null);

  const blurSensitiveAreaAndDownload = async (selectedImage) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${process.env.REACT_APP_BACKEND_URL}/proxy?url=${encodeURIComponent(selectedImage.baseUrl)}`;

    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = img.width;
    canvas.height = img.height;

    ctx.drawImage(img, 0, 0);

    const sensitiveWordsList = selectedImage.sensitiveValue
      .split(/\s+/)
      .map(word => word.toLowerCase().replace(/[^\w]/g, ''));

    const matchingBoxes = selectedImage.sensitiveWords.filter(word => {
      const cleanedWord = word.text.toLowerCase().replace(/[^\w]/g, '');
      return sensitiveWordsList.includes(cleanedWord);
    });

    if (matchingBoxes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      matchingBoxes.forEach(word => {
        const vertices = word.boundingPoly.vertices;
        vertices.forEach(vertex => {
          if (vertex.x < minX) minX = vertex.x;
          if (vertex.y < minY) minY = vertex.y;
          if (vertex.x > maxX) maxX = vertex.x;
          if (vertex.y > maxY) maxY = vertex.y;
        });
      });

      const padding = 10;
      minX = Math.max(0, minX - padding);
      minY = Math.max(0, minY - padding);
      maxX = Math.min(canvas.width, maxX + padding);
      maxY = Math.min(canvas.height, maxY + padding);

      const blurWidth = maxX - minX;
      const blurHeight = maxY - minY;

      const offCanvas = document.createElement('canvas');
      offCanvas.width = blurWidth;
      offCanvas.height = blurHeight;

      const offCtx = offCanvas.getContext('2d');
      offCtx.filter = 'blur(4px)';
      offCtx.drawImage(canvas, minX, minY, blurWidth, blurHeight, 0, 0, blurWidth, blurHeight);

      ctx.drawImage(offCanvas, minX, minY);
    }

    ReactGA.event({
        category: 'Image',
        action: 'Downloaded Blurred Image',
        label: selectedImage.id
      });

    await logToCloud({
        event: 'Downloaded Blurred Image',
        data: { imageId: selectedImage.id },
      });

    const link = document.createElement('a');
    link.download = 'blurred_sensitive_image.png';
    link.href = canvas.toDataURL();
    link.click();
  };

  const handleSensitive = async (image) => {
    await blurSensitiveAreaAndDownload(image);
    try {
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/mark-sensitive`, {
        imageId: image.id,
        status: 'Sensitive',
      });
      setImagesWithText(prev => prev.filter(img => img.id !== image.id));
      closeModal();
    } catch (error) {
      console.error('Failed to mark image as sensitive:', error);
    }
  };

  const handleNotSensitive = async (image) => {
    try {
        ReactGA.event({
            category: 'Image',
            action: 'Marked Not Sensitive',
            label: image.id
          });

          await logToCloud({
            event: 'Marked Not Sensitive',
            data: { imageId: image.id },
          });
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/mark-sensitive`, {
        imageId: image.id,
        status: 'Not Sensitive',
      });
      setImagesWithText(prev => prev.filter(img => img.id !== image.id));
      closeModal();
    } catch (error) {
      console.error('Failed to mark image as not sensitive:', error);
    }
  };

  const logout = () => {
    localStorage.clear();
    window.location.href = '/';

    ReactGA.event({
        category: 'User',
        action: 'Logout'
      });
  };

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar navbar-light bg-white border-bottom px-4 py-2">
        <div className="d-flex align-items-center">
          <img src="/privasee-logo.png" alt="logo" width="35" className="me-2" />
          <h5 className="mb-0 fw-bold">privasee</h5>
        </div>
        <div className="d-flex align-items-center">
          <span className="me-3 fw-medium text-muted">Hi, {username}</span>
          <button className="btn btn-outline-danger btn-sm" onClick={logout}>Logout</button>
        </div>
      </nav>

      {/* Image Grid */}
      <div className="container mt-5">
        {loading ? (
          <div className="text-center">
            <div className="spinner-border text-secondary" role="status" />
            <p className="mt-3">Analyzing your Google Photos...</p>
          </div>
        ) : (
          <div className="row g-4 justify-content-center">
            {imagesWithText.map((img) => (
              <div className="col-6 col-md-4 col-lg-3" key={img.id}>
                <div
                  className="card shadow-sm border-0"
                  onClick={() => openModal(img)}
                  style={{ cursor: 'pointer' }}
                >
                  <img
                    src={img.baseUrl}
                    alt="Sensitive"
                    className="card-img-top"
                    style={{ objectFit: "cover", height: "160px", borderRadius: "10px" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedImage && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-body text-center">
                <img src={selectedImage.baseUrl} alt="Preview" className="img-fluid mb-4" />
                <h5 className="fw-bold">Detected Sensitive Text</h5>
                <p className="mb-1"><strong>Type:</strong> {selectedImage.tag}</p>
                <p><em>{selectedImage.sensitiveValue}</em></p>
                <div className="d-flex justify-content-center gap-3 mt-3">
                  <button className="btn btn-success" onClick={() => handleSensitive(selectedImage)}>
                    Sensitive (Blur & Download)
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleNotSensitive(selectedImage)}>
                    Not Sensitive
                  </button>
                  <button className="btn btn-outline-dark" onClick={closeModal}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
