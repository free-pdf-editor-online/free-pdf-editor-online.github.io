import React, { useState, useRef, useEffect } from 'react';
import { X, RefreshCcw } from 'lucide-react';

const FONTS = [
  'Caveat', 'Cookie', 'Dancing Script', 'Great Vibes', 
  'Handlee', 'Pacifico', 'Patrick Hand', 'Sacramento', 
  'Satisfy', 'Yellowtail'
];

export default function SignatureModal({ isOpen, onClose, onSave }) {
  const [activeTab, setActiveTab] = useState('type'); // 'type' | 'draw' | 'upload'
  const [typedName, setTypedName] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null);
  
  // Drawing state
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (isOpen && activeTab === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // Draw Tab Handlers
  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveDrawnSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Check if empty by inspecting pixel data (optional, but good UX)
    const ctx = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    if (!pixelBuffer.some(color => color !== 0)) {
      // Empty canvas
      return;
    }

    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    onClose();
  };

  const saveTypedSignature = (fontFamily) => {
    if (!typedName.trim()) return;

    // Create a temporary canvas to render the text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set a large font size for high resolution
    const fontSize = 80;
    ctx.font = `${fontSize}px "${fontFamily}"`;
    
    // Measure text to size the canvas perfectly
    const metrics = ctx.measureText(typedName);
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    
    // Add padding
    canvas.width = Math.max(width + 40, 100);
    canvas.height = Math.max(height + 40, 100);
    
    // Reset font after resizing canvas
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'black';
    
    // Draw text centered
    ctx.fillText(typedName, 20, canvas.height / 2);
    
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    onClose();
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  const saveUploadedSignature = () => {
    if (uploadedImage) {
      onSave(uploadedImage);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-800">Create Signature</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 border-b border-slate-200">
          <button 
            onClick={() => setActiveTab('type')}
            className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'type' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Type Signature
          </button>
          <button 
            onClick={() => setActiveTab('draw')}
            className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'draw' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Draw Signature
          </button>
          <button 
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'upload' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Upload Image
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-grow bg-slate-50">
          
          {activeTab === 'type' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Your Name</label>
                <input 
                  type="text" 
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl shadow-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-lg transition-all"
                />
              </div>

              {typedName.trim() && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {FONTS.map(font => (
                    <button
                      key={font}
                      onClick={() => saveTypedSignature(font)}
                      className="p-4 bg-white border border-slate-200 rounded-xl hover:border-red-400 hover:shadow-md transition-all flex items-center justify-center min-h-[100px] overflow-hidden group"
                    >
                      <span 
                        style={{ fontFamily: font }} 
                        className="text-3xl text-slate-800 group-hover:text-red-600 transition-colors whitespace-nowrap"
                      >
                        {typedName}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'draw' && (
            <div className="flex flex-col items-center">
              <div className="w-full bg-white border-2 border-dashed border-slate-300 rounded-xl overflow-hidden shadow-sm relative">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={250}
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  onPointerLeave={stopDrawing}
                  className="w-full h-auto cursor-crosshair touch-none"
                  style={{ minHeight: '250px' }}
                />
              </div>
              <div className="w-full flex justify-between mt-4">
                <button 
                  onClick={clearCanvas}
                  className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-200 bg-slate-100 rounded-lg font-medium transition-colors"
                >
                  <RefreshCcw className="w-4 h-4" /> Clear
                </button>
                <button 
                  onClick={saveDrawnSignature}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 shadow-sm transition-colors"
                >
                  Create Signature
                </button>
              </div>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="flex flex-col items-center">
              {!uploadedImage ? (
                <div className="w-full flex flex-col items-center justify-center py-12 px-4 border-2 border-dashed border-slate-300 rounded-xl bg-white">
                  <p className="text-slate-500 mb-4">Upload a photo or scan of your signature (PNG or JPG).</p>
                  <label className="cursor-pointer px-6 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm">
                    Select Image
                    <input type="file" className="hidden" accept="image/png, image/jpeg" onChange={handleImageUpload} />
                  </label>
                </div>
              ) : (
                <div className="w-full flex flex-col items-center">
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-center min-h-[250px]">
                    <img src={uploadedImage} alt="Uploaded signature" className="max-w-full max-h-[200px] object-contain" />
                  </div>
                  <div className="w-full flex justify-between mt-4">
                    <button 
                      onClick={() => setUploadedImage(null)}
                      className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-200 bg-slate-100 rounded-lg font-medium transition-colors"
                    >
                      <RefreshCcw className="w-4 h-4" /> Change Image
                    </button>
                    <button 
                      onClick={saveUploadedSignature}
                      className="px-6 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 shadow-sm transition-colors"
                    >
                      Use Signature
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
