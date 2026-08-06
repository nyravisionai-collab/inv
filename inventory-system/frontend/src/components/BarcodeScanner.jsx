import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { X } from 'lucide-react';

export default function BarcodeScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('reader', {
      fps: 10,
      qrbox: { width: 250, height: 150 },
      aspectRatio: 1.0,
    });

    scanner.render(
      (decodedText) => {
        onScan(decodedText);
        scanner.clear().catch(() => {});
      },
      (error) => {
        // quiet
      }
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  return (
    <div className="barcode-scanner-overlay">
      <div className="barcode-scanner-container">
        <div className="barcode-scanner-header">
          <span>Scan Barcode</span>
          <button onClick={onClose} className="btn-icon"><X size={20} /></button>
        </div>
        <div id="reader" style={{ width: '100%' }}></div>
      </div>
    </div>
  );
}
