import { useState, useRef, useCallback } from 'react';

/**
 * Native PDF Viewer using browser's built-in PDF renderer
 * Uses iframe with PDF URL and page fragment navigation
 */
export default function NativePDFViewer({ fileUrl, initialPage = 1 }) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [inputValue, setInputValue] = useState(String(initialPage));
  const iframeRef = useRef(null);

  // Navigation by reloading iframe with new URL fragment
  const goToPage = useCallback((pageNum) => {
    const page = Math.max(1, pageNum);
    setCurrentPage(page);
    setInputValue(String(page));
  }, []);

  const previousPage = () => goToPage(currentPage - 1);
  const nextPage = () => goToPage(currentPage + 1);

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const page = parseInt(inputValue, 10);
    if (!isNaN(page) && page >= 1) {
      goToPage(page);
    } else {
      setInputValue(String(currentPage));
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleInputBlur();
    }
  };

  // Construct URL with page fragment
  const pdfUrlWithPage = `${fileUrl}#page=${currentPage}`;

  return (
    <div className="native-pdf-viewer">
      <div className="pdf-toolbar">
        <button
          className="pdf-nav-btn"
          onClick={previousPage}
          disabled={currentPage <= 1}
          title="Previous page"
        >
          ←
        </button>
        <span className="pdf-page-info">
          <input
            type="number"
            min={1}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            className="pdf-page-input"
          />
        </span>
        <button
          className="pdf-nav-btn"
          onClick={nextPage}
          title="Next page"
        >
          →
        </button>
      </div>

      <iframe
        ref={iframeRef}
        key={currentPage} // Force reload on page change
        src={pdfUrlWithPage}
        className="pdf-iframe"
        title="PDF Viewer"
      />
    </div>
  );
}

export { NativePDFViewer };
