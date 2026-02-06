import { useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import NativePDFViewer from './NativePDFViewer';

/**
 * Modal wrapper for PDF viewer
 * Displays a PDF in a modal overlay when triggered
 */
const PDFViewerModal = memo(function PDFViewerModal({
  isOpen,
  onClose,
  fileUrl,
  filename,
  initialPage = 1
}) {
  // Handle escape key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // Handle backdrop click to close
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Add/remove event listeners
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="pdf-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-modal-title"
    >
      <div className="pdf-modal-container">
        <div className="pdf-modal-header">
          <h2 id="pdf-modal-title" className="pdf-modal-title">
            {filename || 'PDF Document'}
          </h2>
          <button
            className="pdf-modal-close"
            onClick={onClose}
            aria-label="Close PDF viewer"
          >
            &times;
          </button>
        </div>
        <div className="pdf-modal-content">
          <NativePDFViewer
            fileUrl={fileUrl}
            initialPage={initialPage}
          />
        </div>
      </div>
    </div>,
    document.body
  );
});

export default PDFViewerModal;
export { PDFViewerModal };
