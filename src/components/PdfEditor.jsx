import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, BlendMode, LineCapStyle } from 'pdf-lib';
import { UploadCloud, Type, Pen, Square, Download, ChevronLeft, ChevronRight, X, Trash2, Eraser, MousePointer, Pencil, Move, FileSignature, Moon, Sun, Check, Stamp, Grid3X3, Edit3, Bold, Italic, Highlighter } from 'lucide-react';
import SignatureModal from './SignatureModal';
import OrganizeView from './OrganizeView';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

const TOOLS = {
  NONE: 'none',
  TEXT: 'text',
  DRAW: 'draw',
  BLACKOUT: 'blackout',
  WHITEOUT: 'whiteout',
  HIGHLIGHT: 'highlight',
  SIGNATURE: 'signature',
  CHECKMARK: 'checkmark',
  CROSS: 'cross',
  STAMP: 'stamp',
};

const PDF_SCALE = 1.5;

export default function PdfEditor() {
  const [file, setFile] = useState(null);
  const [fileBuffer, setFileBuffer] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1); // 1-indexed display page number
  const [numPages, setNumPages] = useState(0); // total display pages
  const [pageOrder, setPageOrder] = useState([]); // [{ id: string, originalNum: number }]
  const [viewMode, setViewMode] = useState('edit'); // 'edit' | 'organize'
  const [viewport, setViewport] = useState(null);
  const [tool, setTool] = useState(TOOLS.NONE);
  
  // annotations: { [page]: [ {id, type, ...} ] }
  const [annotations, setAnnotations] = useState({});
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);
  const [currentBlackout, setCurrentBlackout] = useState(null);
  
  // For text input — editingId tracks which existing annotation we're editing (null = new text)
  const [textInput, setTextInput] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draggingText, setDraggingText] = useState(null);
  const [resizingImage, setResizingImage] = useState(null);
  const [selectedDrawId, setSelectedDrawId] = useState(null);
  const [hoveredDrawId, setHoveredDrawId] = useState(null);
  const [activeAnnId, setActiveAnnId] = useState(null);

  // Signature state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [activeSignature, setActiveSignature] = useState(null); // dataURL of the signature

  // Night Mode state
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Stamp state
  const [selectedStamp, setSelectedStamp] = useState('APPROVED');
  const [customStampText, setCustomStampText] = useState('CUSTOM TEXT');
  const [customStampColor, setCustomStampColor] = useState('rgb(239, 68, 68)');
  
  // Font Size state
  const [textSize, setTextSize] = useState(14);
  const [isTextBold, setIsTextBold] = useState(false);
  const [isTextItalic, setIsTextItalic] = useState(false);
  
  // Highlight state
  const [highlightColor, setHighlightColor] = useState('rgb(253, 224, 71)'); // yellow-300
  const STAMP_OPTIONS = [
    { text: 'APPROVED', color: 'rgb(34, 197, 94)' }, // green-500
    { text: 'CONFIDENTIAL', color: 'rgb(239, 68, 68)' }, // red-500
    { text: 'DRAFT', color: 'rgb(59, 130, 246)' }, // blue-500
    { text: 'CUSTOM...', color: 'custom' }
  ];

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const containerRef = useRef(null);
  const textInputRef = useRef(null);

  // --- PDF Loading & Rendering ---
  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    const buffer = await uploadedFile.arrayBuffer();
    setFileBuffer(buffer);
    
    const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
    const pdf = await loadingTask.promise;
    setPdfDoc(pdf);
    
    // Initialize page order
    const initialOrder = Array.from({ length: pdf.numPages }, (_, i) => ({
      id: `page-${i + 1}-${Date.now()}`,
      originalNum: i + 1
    }));
    setPageOrder(initialOrder);
    setNumPages(initialOrder.length);
    setPageNum(1);
    setViewMode('edit');
  };

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || pageOrder.length === 0) return;

    try {
      // Look up the original page number for the current display page
      const originalPageNum = pageOrder[pageNum - 1].originalNum;
      const page = await pdfDoc.getPage(originalPageNum);
      const vp = page.getViewport({ scale: PDF_SCALE });
      setViewport(vp);

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.width = vp.width;
      canvas.height = vp.height;

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const renderContext = {
        canvasContext: context,
        viewport: vp,
      };

      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    }
  }, [pdfDoc, pageNum, pageOrder]);

  // Update numPages if pageOrder length changes (e.g. deletion)
  useEffect(() => {
    setNumPages(pageOrder.length);
    if (pageNum > pageOrder.length && pageOrder.length > 0) {
      setPageNum(pageOrder.length);
    }
  }, [pageOrder, pageNum]);

  useEffect(() => {
    if (viewMode === 'edit') {
      // Small timeout ensures the canvas DOM node is fully mounted after state switch
      setTimeout(renderPage, 0);
    }
  }, [renderPage, viewMode]);

  // Helper to get the actual original page number for state updates
  const getOriginalPageNum = () => pageOrder[pageNum - 1]?.originalNum;

  // Focus the text input whenever it appears
  useEffect(() => {
    if (textInput && textInputRef.current) {
      const timer = setTimeout(() => {
        textInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [textInput?.x, textInput?.y]);

  // Global Escape key to deselect tool
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        commitTextInput();
        setTool(TOOLS.NONE);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // --- Coordinate Mapping ---
  // Gets mouse coordinates in unscaled PDF space (top-left origin)
  const getMouseCoords = (e) => {
    if (!containerRef.current || !viewport) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = viewport.width / rect.width;
    const scaleY = viewport.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    return {
      x: x / PDF_SCALE,
      y: y / PDF_SCALE
    };
  };

  // --- Interaction Handlers ---
  const handlePointerDown = (e) => {
    setSelectedDrawId(null);
    setActiveAnnId(null);
    const coords = getMouseCoords(e);
    if (!coords) return;
    
    const originalPage = getOriginalPageNum();
    if (!originalPage) return;

    if (tool === TOOLS.SIGNATURE && activeSignature) {
      stampSignature(activeSignature);
      return;
    }

    if (tool === TOOLS.NONE) {
      // In select mode, commit any open text input
      commitTextInput();
      return;
    }

    if (tool === TOOLS.DRAW) {
      setIsDrawing(true);
      setCurrentPath({ type: 'draw', points: [coords], id: Date.now().toString() });
    } else if (tool === TOOLS.BLACKOUT || tool === TOOLS.WHITEOUT || tool === TOOLS.HIGHLIGHT) {
      setIsDrawing(true);
      const rectType = tool === TOOLS.WHITEOUT ? 'whiteout' : (tool === TOOLS.HIGHLIGHT ? 'highlight' : 'blackout');
      setCurrentBlackout({ type: rectType, start: coords, rect: { x: coords.x, y: coords.y, w: 0, h: 0 }, id: Date.now().toString(), color: tool === TOOLS.HIGHLIGHT ? highlightColor : undefined });
    } else if (tool === TOOLS.CHECKMARK || tool === TOOLS.CROSS) {
      addAnnotation(originalPage, { 
        id: Date.now().toString(), 
        type: 'symbol', 
        symbol: tool === TOOLS.CHECKMARK ? 'check' : 'cross', 
        x: coords.x, 
        y: coords.y,
        scale: 1
      });
      // Optionally reset to NONE or keep selected for multiple clicks
    } else if (tool === TOOLS.STAMP) {
      let stampText = selectedStamp;
      let stampColor = 'rgb(239, 68, 68)';

      if (selectedStamp === 'CUSTOM...') {
        stampText = customStampText || 'STAMP';
        stampColor = customStampColor;
      } else {
        const stampConf = STAMP_OPTIONS.find(s => s.text === selectedStamp);
        if (stampConf) stampColor = stampConf.color;
      }

      addAnnotation(originalPage, { 
        id: Date.now().toString(), 
        type: 'stamp', 
        text: stampText, 
        color: stampColor, 
        x: coords.x, 
        y: coords.y,
        scale: 1
      });
    } else if (tool === TOOLS.TEXT) {
      // Commit any existing text input first
      commitTextInput();
      // Place a new text input at click location
      setEditingId(null);
      setTextInput({
        x: coords.x,
        y: coords.y,
        text: '',
        size: textSize,
        isBold: isTextBold,
        isItalic: isTextItalic
      });
    }
  };

  const handleTextDragStart = (e, ann) => {
    e.stopPropagation();
    setActiveAnnId(ann.id);
    const coords = getMouseCoords(e);
    if (!coords) return;
    setDraggingText({
      id: ann.id,
      offsetX: coords.x - ann.x,
      offsetY: coords.y - ann.y
    });
  };

  const handleImageResizeStart = (e, ann) => {
    e.stopPropagation();
    const coords = getMouseCoords(e);
    if (!coords) return;
    setResizingImage({
      id: ann.id,
      startX: coords.x,
      startY: coords.y,
      startW: ann.w || 100, // default if scaling a symbol/stamp
      startH: ann.h || 100,
      startScale: ann.scale || 1,
      aspectRatio: (ann.w && ann.h) ? ann.w / ann.h : 1,
      type: ann.type
    });
  };

  const handlePointerMove = (e) => {
    const coords = getMouseCoords(e);
    if (!coords) return;

    if (draggingText) {
      setAnnotations(prev => {
        const originalPage = getOriginalPageNum();
        const pageAnns = prev[originalPage] || [];
        const updated = pageAnns.map(a => 
          a.id === draggingText.id 
            ? { ...a, x: coords.x - draggingText.offsetX, y: coords.y - draggingText.offsetY }
            : a
        );
        return { ...prev, [originalPage]: updated };
      });
      return;
    }

    if (resizingImage) {
      const coords = getMouseCoords(e);
      if (!coords) return;
      
      const originalPage = getOriginalPageNum();
      const dx = coords.x - resizingImage.startX;
      
      setAnnotations(prev => {
        const pageAnns = prev[originalPage] || [];
        const updated = pageAnns.map(a => {
          if (a.id === resizingImage.id) {
            if (resizingImage.type === 'image') {
              const newW = Math.max(20, resizingImage.startW + dx);
              const newH = newW / resizingImage.aspectRatio;
              return { ...a, w: newW, h: newH };
            } else if (resizingImage.type === 'symbol' || resizingImage.type === 'stamp') {
              // Scale based on dx (e.g. every 50px dx = 0.5 scale increment)
              const scaleDelta = dx / 100;
              const newScale = Math.max(0.5, resizingImage.startScale + scaleDelta);
              return { ...a, scale: newScale };
            }
          }
          return a;
        });
        return { ...prev, [originalPage]: updated };
      });
      return;
    }

    if (!isDrawing) return;

    if (tool === TOOLS.DRAW && currentPath) {
      setCurrentPath(prev => ({
        ...prev,
        points: [...prev.points, coords]
      }));
    } else if ((tool === TOOLS.BLACKOUT || tool === TOOLS.WHITEOUT || tool === TOOLS.HIGHLIGHT) && currentBlackout) {
      setCurrentBlackout(prev => {
        const start = prev.start;
        const x = Math.min(start.x, coords.x);
        const y = Math.min(start.y, coords.y);
        const w = Math.abs(coords.x - start.x);
        const h = Math.abs(coords.y - start.y);
        return { ...prev, rect: { x, y, w, h } };
      });
    }
  };

  const handlePointerUp = () => {
    if (draggingText) {
      setDraggingText(null);
      return;
    }

    if (resizingImage) {
      setResizingImage(null);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);
    
    const originalPage = getOriginalPageNum();
    if (!originalPage) return;

    if (tool === TOOLS.DRAW && currentPath) {
      addAnnotation(originalPage, { ...currentPath });
      setCurrentPath(null);
    } else if ((tool === TOOLS.BLACKOUT || tool === TOOLS.WHITEOUT || tool === TOOLS.HIGHLIGHT) && currentBlackout) {
      if (currentBlackout.rect.w > 5 && currentBlackout.rect.h > 5) {
        addAnnotation(originalPage, { 
          type: currentBlackout.type, 
          ...currentBlackout.rect, 
          id: currentBlackout.id,
          color: currentBlackout.color
        });
      }
      setCurrentBlackout(null);
    }
  };

  const addAnnotation = (page, annotation) => {
    setAnnotations(prev => ({
      ...prev,
      [page]: [...(prev[page] || []), annotation]
    }));
  };

  const deleteAnnotation = (page, id) => {
    setAnnotations(prev => ({
      ...prev,
      [page]: (prev[page] || []).filter(a => a.id !== id)
    }));
  };

  // Commits the current text input as an annotation (if non-empty)
  const commitTextInput = () => {
    // Capture the current editingId synchronously before scheduling the update
    const currentEditingId = editingId;

    setTextInput(prev => {
      if (prev && prev.text.trim()) {
        const originalPage = getOriginalPageNum();
        setTimeout(() => {
          setAnnotations(a => {
            const pageAnns = a[originalPage] || [];
            // Remove the old annotation if we are editing an existing one
            const filtered = currentEditingId 
              ? pageAnns.filter(ann => ann.id !== currentEditingId)
              : pageAnns;
              
            // Append the new/updated text annotation (reuse ID if editing)
            const newAnnotation = {
              id: currentEditingId || Date.now().toString(),
              type: 'text',
              x: prev.x,
              y: prev.y,
              text: prev.text,
              size: prev.size || textSize,
              isBold: prev.isBold,
              isItalic: prev.isItalic
            };

            return {
              ...a,
              [originalPage]: [...filtered, newAnnotation]
            };
          });
        }, 0);
      }
      return null;
    });

    // Clear editing state synchronously so it can be safely overridden by startEditingText
    setEditingId(null);
  };

  // Start editing an existing text annotation
  const startEditingText = (ann) => {
    commitTextInput();
    setEditingId(ann.id);
    setTextInput({
      x: ann.x,
      y: ann.y,
      text: ann.text,
      size: ann.size,
      isBold: ann.isBold,
      isItalic: ann.isItalic
    });
  };

  const handleTextKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTextInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
      setTextInput(null);
      setSelectedDrawId(null);
    }
  };

  const stampSignature = (dataUrl) => {
    const img = new Image();
    img.onload = () => {
      // Scale down the signature a bit for the PDF
      let sigWidth = img.width * 0.5;
      let sigHeight = img.height * 0.5;
      
      // Cap max width to 200px initially so massive phone photos don't overflow the page
      if (sigWidth > 200) {
        const ratio = 200 / sigWidth;
        sigWidth = 200;
        sigHeight = sigHeight * ratio;
      }
      
      // Place near the center of the page horizontally and 100px down (or top-left if page is small)
      const x = viewport ? (viewport.width / PDF_SCALE / 2) - (sigWidth / 2) : 50;
      const y = 100;
      
      const originalPage = getOriginalPageNum();
      if (!originalPage) return;

      addAnnotation(originalPage, {
        id: Date.now().toString(),
        type: 'image',
        x: Math.max(10, x),
        y: Math.max(10, y),
        w: sigWidth,
        h: sigHeight,
        dataUrl: dataUrl
      });
      setTool(TOOLS.NONE); // Switch to select tool so they can drag it
    };
    img.src = dataUrl;
  };

  // --- Export Logic ---
  const handleExport = async () => {
    if (!fileBuffer) return;
    
    try {
      const originalPdf = await PDFDocument.load(fileBuffer);
      const fontHelvetica = await originalPdf.embedFont(StandardFonts.Helvetica);
      const fontBold = await originalPdf.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await originalPdf.embedFont(StandardFonts.HelveticaOblique);
      const fontBoldItalic = await originalPdf.embedFont(StandardFonts.HelveticaBoldOblique);
      
      const originalPages = originalPdf.getPages();
      
      // Apply annotations to original pages first
      for (const [pNumStr, pageAnnotations] of Object.entries(annotations)) {
        const pNum = parseInt(pNumStr, 10);
        const page = originalPages[pNum - 1];
        if (!page) continue;
        
        const { height } = page.getSize();
        
        for (const ann of pageAnnotations) {
          if (ann.type === 'text') {
            let font = fontHelvetica;
            if (ann.isBold && ann.isItalic) font = fontBoldItalic;
            else if (ann.isBold) font = fontBold;
            else if (ann.isItalic) font = fontItalic;

            page.drawText(ann.text, {
              x: ann.x + (10 / PDF_SCALE), 
              y: height - ann.y - (6 / PDF_SCALE) - (ann.size * 0.8), 
              size: ann.size,
              font: font,
              color: rgb(0, 0, 0),
            });
          } else if (ann.type === 'draw') {
            for (let i = 1; i < ann.points.length; i++) {
              const p1 = ann.points[i - 1];
              const p2 = ann.points[i];
              page.drawLine({
                start: { x: p1.x, y: height - p1.y },
                end: { x: p2.x, y: height - p2.y },
                thickness: 2,
                color: rgb(0, 0, 0),
              });
            }
          } else if (ann.type === 'blackout' || ann.type === 'whiteout' || ann.type === 'highlight') {
            const isHighlight = ann.type === 'highlight';
            let fillColor;
            if (isHighlight) {
              const rgbVals = ann.color.match(/\d+/g).map(Number).map(c => c / 255);
              fillColor = rgb(rgbVals[0], rgbVals[1], rgbVals[2]);
            } else {
              fillColor = ann.type === 'whiteout' ? rgb(1, 1, 1) : rgb(0, 0, 0);
            }
            
            page.drawRectangle({
              x: ann.x,
              // For rectangle, bottom-left Y is pageHeight - topY - height
              y: height - ann.y - ann.h,
              width: ann.w,
              height: ann.h,
              color: fillColor,
              opacity: isHighlight ? 0.4 : 1,
            });
          } else if (ann.type === 'symbol') {
            const scale = ann.scale || 1;
            const svgScale = scale * 0.8888;
            const thickness = 2.66 * scale; // Exactly 4px scaled down to PDF points
            
            if (ann.symbol === 'check') {
              // M20 6 9 17l-5-5 -> (4, 12) to (9, 17) to (20, 6)
              // (0,0) of viewBox is at exactly (ann.x, height - ann.y)
              page.drawLine({
                start: { x: ann.x + 4 * svgScale, y: height - ann.y - 12 * svgScale },
                end: { x: ann.x + 9 * svgScale, y: height - ann.y - 17 * svgScale },
                thickness: thickness, color: rgb(0, 0, 0), lineCap: LineCapStyle.Round
              });
              page.drawLine({
                start: { x: ann.x + 9 * svgScale, y: height - ann.y - 17 * svgScale },
                end: { x: ann.x + 20 * svgScale, y: height - ann.y - 6 * svgScale },
                thickness: thickness, color: rgb(0, 0, 0), lineCap: LineCapStyle.Round
              });
            } else if (ann.symbol === 'cross') {
              // M18 6 6 18 -> (18,6) to (6,18).
              page.drawLine({
                start: { x: ann.x + 18 * svgScale, y: height - ann.y - 6 * svgScale },
                end: { x: ann.x + 6 * svgScale, y: height - ann.y - 18 * svgScale },
                thickness: thickness, color: rgb(0, 0, 0), lineCap: LineCapStyle.Round
              });
              // M6 6l12 12 -> (6,6) to (18,18).
              page.drawLine({
                start: { x: ann.x + 6 * svgScale, y: height - ann.y - 6 * svgScale },
                end: { x: ann.x + 18 * svgScale, y: height - ann.y - 18 * svgScale },
                thickness: thickness, color: rgb(0, 0, 0), lineCap: LineCapStyle.Round
              });
            }
          } else if (ann.type === 'stamp') {
            const rgbColor = ann.color.match(/\d+/g).map(Number).map(c => c / 255);
            const rColor = rgb(rgbColor[0], rgbColor[1], rgbColor[2]);
            const scale = ann.scale || 1;
            
            const size = 16 * scale; // 24px UI -> 16 PDF points
            const textWidth = fontBold.widthOfTextAtSize(ann.text, size);
            
            const sw = textWidth + (26.66 * scale);
            const sh = 32 * scale; // 48px UI -> 32 PDF points
            
            // Draw Border anchored at top-left (ann.x, height - ann.y - sh)
            page.drawRectangle({
              x: ann.x,
              y: height - ann.y - sh,
              width: sw,
              height: sh,
              borderColor: rColor,
              borderWidth: 2.66 * scale,
            });
            
            // Draw Text perfectly positioned inside the top-left anchored box
            page.drawText(ann.text, {
              x: ann.x + (13.33 * scale), // left padding
              y: height - ann.y - sh + (10 * scale), // baseline relative to bottom edge
              size: size,
              font: fontBold,
              color: rColor,
            });
          } else if (ann.type === 'image') {
            // Embed PNG or JPG by extracting base64
            const isJpeg = ann.dataUrl.startsWith('data:image/jpeg') || ann.dataUrl.startsWith('data:image/jpg');
            const base64Data = ann.dataUrl.split(',')[1];
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            const pdfImage = isJpeg ? await originalPdf.embedJpg(bytes) : await originalPdf.embedPng(bytes);
            
            page.drawImage(pdfImage, {
              x: ann.x,
              y: height - ann.y - ann.h,
              width: ann.w,
              height: ann.h,
            });
          }
        }
      }
      
      // Create a new blank PDF and copy the pages in the user's chosen order
      const newPdf = await PDFDocument.create();
      const pageIndicesToCopy = pageOrder.map(p => p.originalNum - 1);
      
      if (pageIndicesToCopy.length > 0) {
        const copiedPages = await newPdf.copyPages(originalPdf, pageIndicesToCopy);
        copiedPages.forEach((copiedPage) => {
          newPdf.addPage(copiedPage);
        });
      }
      
      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `edited_${file.name}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Error: ' + error.message);
    }
  };

  // --- UI Renderers ---
  if (!file) {
    return (
      <div className="max-w-4xl mx-auto mt-6 md:mt-12 p-4 md:p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center mx-4 md:mx-auto">
        <div className="flex flex-col items-center justify-center py-12 md:py-16 px-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
          <UploadCloud className="w-16 h-16 text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload a PDF to start editing</h2>
          <p className="text-slate-500 mb-6 max-w-md">Your files are processed securely in your browser and are never uploaded to any server.</p>
          <label className="cursor-pointer inline-flex items-center justify-center px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors shadow-sm">
            <span>Select PDF File</span>
            <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
          </label>
        </div>
      </div>
    );
  }

  const currentPageAnnotations = annotations[getOriginalPageNum()] || [];

  return (
    <div className="max-w-6xl mx-auto mt-4 md:mt-8 px-2 md:px-0 flex flex-col lg:flex-row gap-6">
      
      {/* Toolbar */}
      <div className="w-full lg:w-64 flex-shrink-0">
        {/* Night Mode Toggle */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4 flex items-center justify-between">
          <span className="font-semibold text-slate-800 text-sm">Eye Care Mode</span>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isDarkMode ? 'bg-red-600' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDarkMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2 mb-4 flex">
          <button
            onClick={() => setViewMode('edit')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-colors ${viewMode === 'edit' ? 'bg-red-50 text-red-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Edit3 className="w-4 h-4" /> Edit
          </button>
          <button
            onClick={() => { commitTextInput(); setViewMode('organize'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-colors ${viewMode === 'organize' ? 'bg-red-50 text-red-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Grid3X3 className="w-4 h-4" /> Organize
          </button>
        </div>

        <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 lg:sticky lg:top-24 ${viewMode === 'organize' ? 'opacity-50 pointer-events-none' : ''}`}>
          <h3 className="font-semibold text-slate-800 mb-4 px-2">Tools</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:flex lg:flex-col gap-2">
            <button 
              onClick={() => { commitTextInput(); setTool(TOOLS.NONE); }}
              className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.NONE ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
            >
              <MousePointer className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Select</span>
            </button>
            <div className={`flex flex-col gap-2 ${tool === TOOLS.TEXT ? 'col-span-full' : ''}`}>
              <button 
                onClick={() => { commitTextInput(); setTool(tool === TOOLS.TEXT ? TOOLS.NONE : TOOLS.TEXT); }}
                className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.TEXT ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
              >
                <Type className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Add Text</span>
              </button>
              {tool === TOOLS.TEXT && (
                <div className="flex flex-col gap-2 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-600">Size:</span>
                    <select
                      value={textSize}
                      onChange={(e) => {
                        const newSize = parseInt(e.target.value, 10);
                        setTextSize(newSize);
                        if (textInput) {
                          setTextInput(prev => ({ ...prev, size: newSize }));
                        }
                      }}
                      className="flex-1 p-1 bg-white border border-slate-200 rounded text-sm outline-none text-slate-700"
                    >
                      {[10, 12, 14, 16, 18, 24, 32, 48].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setIsTextBold(!isTextBold);
                        if (textInput) setTextInput(prev => ({ ...prev, isBold: !prev.isBold }));
                      }}
                      className={`flex-1 p-1.5 rounded border transition-colors flex items-center justify-center ${isTextBold ? 'bg-red-100 border-red-300 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                      aria-label="Bold" title="Bold"
                    >
                      <Bold className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setIsTextItalic(!isTextItalic);
                        if (textInput) setTextInput(prev => ({ ...prev, isItalic: !prev.isItalic }));
                      }}
                      className={`flex-1 p-1.5 rounded border transition-colors flex items-center justify-center ${isTextItalic ? 'bg-red-100 border-red-300 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                      aria-label="Italic" title="Italic"
                    >
                      <Italic className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={() => { commitTextInput(); setTool(tool === TOOLS.DRAW ? TOOLS.NONE : TOOLS.DRAW); }}
              className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.DRAW ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
            >
              <Pen className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Freehand</span>
            </button>
            <div className={`flex flex-col gap-2 ${activeSignature ? 'col-span-full' : ''}`}>
              {!activeSignature ? (
                <button 
                  onClick={() => { 
                    commitTextInput(); 
                    setIsSignatureModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left text-slate-600 hover:bg-slate-50 border border-transparent"
                >
                  <FileSignature className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Signature</span>
                </button>
              ) : (
              <div className="flex flex-col gap-1 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 pt-1">Your Signature</span>
                <button 
                  onClick={() => { commitTextInput(); stampSignature(activeSignature); }}
                  className="w-full flex flex-col items-center gap-2 px-4 py-3 bg-white rounded-lg border border-slate-200 hover:border-red-400 hover:shadow-sm transition-all group"
                  aria-label="Click to place on document" title="Click to place on document"
                >
                  <img src={activeSignature} alt="Current Signature" className="h-10 object-contain opacity-80 group-hover:opacity-100 transition-opacity" />
                  <span className="text-xs font-medium text-red-600">Click to place</span>
                </button>
                <button 
                  onClick={() => { commitTextInput(); setIsSignatureModalOpen(true); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-1 text-sm font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <FileSignature className="w-4 h-4" /> Create New
                </button>
              </div>
              )}
            </div>
            <button 
              onClick={() => { commitTextInput(); setTool(tool === TOOLS.BLACKOUT ? TOOLS.NONE : TOOLS.BLACKOUT); }}
              className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.BLACKOUT ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
            >
              <Square className="w-5 h-5 fill-current flex-shrink-0" /> <span className="truncate text-sm md:text-base">Blackout</span>
            </button>
            <button 
              onClick={() => { commitTextInput(); setTool(tool === TOOLS.WHITEOUT ? TOOLS.NONE : TOOLS.WHITEOUT); }}
              className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.WHITEOUT ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
            >
              <Eraser className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Whiteout</span>
            </button>
            <div className={`flex flex-col gap-2 ${tool === TOOLS.HIGHLIGHT ? 'col-span-full' : ''}`}>
              <button 
                onClick={() => { commitTextInput(); setTool(tool === TOOLS.HIGHLIGHT ? TOOLS.NONE : TOOLS.HIGHLIGHT); }}
                className={`w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.HIGHLIGHT ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
              >
                <Highlighter className="w-5 h-5 flex-shrink-0" /> <span className="truncate text-sm md:text-base">Highlight</span>
              </button>
              {tool === TOOLS.HIGHLIGHT && (
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-xs font-semibold text-slate-500 block mb-2 px-1">Choose Color</span>
                  <div className="flex justify-between px-1">
                    {['rgb(253, 224, 71)', 'rgb(134, 239, 172)', 'rgb(147, 197, 253)', 'rgb(249, 168, 212)', 'rgb(216, 180, 254)'].map(color => (
                      <button
                        key={color}
                        onClick={() => setHighlightColor(color)}
                        className={`w-6 h-6 rounded-full border-2 ${highlightColor === color ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-110'} transition-transform shadow-sm`}
                        style={{ backgroundColor: color, opacity: 0.8 }}
                        aria-label="Select highlight color" title="Select highlight color"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Fill & Stamp</h4>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => { commitTextInput(); setTool(TOOLS.CHECKMARK); }}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-colors font-medium ${tool === TOOLS.CHECKMARK ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
                aria-label="Add Checkmark" title="Add Checkmark"
              >
                <Check className="w-5 h-5" />
              </button>
              <button 
                onClick={() => { commitTextInput(); setTool(TOOLS.CROSS); }}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-colors font-medium ${tool === TOOLS.CROSS ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
                aria-label="Add Cross" title="Add Cross"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {(tool === TOOLS.CHECKMARK || tool === TOOLS.CROSS) && (
              <p className="text-xs text-slate-500 mt-2 text-center">Click canvas to place symbol</p>
            )}
            
            <div className="mt-2">
              <button 
                onClick={() => { commitTextInput(); setTool(TOOLS.STAMP); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-medium text-left ${tool === TOOLS.STAMP ? 'bg-red-50 text-red-700 border border-red-200' : 'text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
              >
                <Stamp className={`w-5 h-5 ${tool === TOOLS.STAMP ? 'text-red-600' : 'text-slate-400'}`} />
                <span>Stamp</span>
              </button>
              {tool === TOOLS.STAMP && (
                <div className="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <select 
                    value={selectedStamp}
                    onChange={(e) => setSelectedStamp(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded text-sm font-medium outline-none text-slate-700"
                  >
                    {STAMP_OPTIONS.map(s => (
                      <option key={s.text} value={s.text}>{s.text}</option>
                    ))}
                  </select>
                  
                  {selectedStamp === 'CUSTOM...' && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-2">
                      <input 
                        type="text" 
                        value={customStampText}
                        onChange={(e) => setCustomStampText(e.target.value)}
                        placeholder="Enter text..."
                        maxLength={20}
                        className="w-full p-2 bg-white border border-slate-200 rounded text-sm font-medium outline-none text-slate-700 uppercase"
                      />
                      <div className="flex justify-between px-1">
                        {['rgb(239, 68, 68)', 'rgb(34, 197, 94)', 'rgb(59, 130, 246)', 'rgb(0, 0, 0)', 'rgb(249, 115, 22)'].map(color => (
                          <button
                            key={color}
                            onClick={() => setCustomStampColor(color)}
                            className={`w-6 h-6 rounded-full border-2 ${customStampColor === color ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-110'} transition-transform`}
                            style={{ backgroundColor: color }}
                            aria-label="Select color" title="Select color"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <p className="text-xs text-slate-500 mt-3 text-center">Click canvas to stamp</p>
                </div>
              )}
            </div>
          </div>

          <div className="my-6 border-t border-slate-100"></div>
          
          <button 
            onClick={() => { commitTextInput(); setTimeout(handleExport, 100); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors shadow-sm"
          >
            <Download className="w-5 h-5" /> Download PDF
          </button>
        </div>
      </div>

      {/* Main Area */}
      {viewMode === 'edit' ? (
        <div className="flex-grow flex flex-col items-center">
          
          {/* Pagination Controls */}
        <div className="bg-white rounded-full shadow-sm border border-slate-200 px-4 py-2 flex items-center gap-4 mb-6">
          <button 
            disabled={pageNum <= 1}
            onClick={() => setPageNum(p => Math.max(1, p - 1))}
            className="p-1 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-slate-700">Page {pageNum} of {numPages}</span>
          <button 
            disabled={pageNum >= numPages}
            onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
            className="p-1 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Main Document Container - Wrapped for horizontal scrolling on mobile */}
        <div className="w-full max-w-full overflow-x-auto flex justify-start lg:justify-center rounded-xl lg:rounded-none">
          <div 
            className="relative bg-white shadow-xl transition-all flex-shrink-0"
            style={{ 
              width: viewport ? `${viewport.width}px` : 'auto', 
              height: viewport ? `${viewport.height}px` : 'auto',
              filter: isDarkMode ? 'invert(1) hue-rotate(180deg) brightness(0.9)' : 'none'
            }}
          >
            {/* Base PDF Canvas */}
            <canvas ref={canvasRef} className="block" />

          {/* Interactive Overlay for drawing and rendering annotations */}
          <div 
            ref={containerRef}
            className="absolute inset-0"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {/* Render Saved Annotations */}
            {currentPageAnnotations.map((ann) => {
              if (ann.type === 'text') {
                // Hide this annotation if we're currently editing it
                if (editingId === ann.id) return null;
                return (
                  <div 
                    key={ann.id} 
                    className={`absolute text-black font-sans group whitespace-nowrap cursor-text px-2 py-1 border-2 border-transparent ${ann.isBold ? 'font-bold' : ''} ${ann.isItalic ? 'italic' : ''}`}
                    style={{ 
                      left: `${ann.x * PDF_SCALE}px`, 
                      top: `${ann.y * PDF_SCALE}px`,
                      fontSize: `${ann.size * PDF_SCALE}px`,
                      lineHeight: 1
                    }}
                  >
                    {ann.text}
                    <div 
                      className={`absolute -top-10 left-0 flex gap-1 ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity z-10 bg-white shadow-md rounded-lg p-1 border border-slate-200 cursor-default after:absolute after:-bottom-4 after:left-0 after:right-0 after:h-4`}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button 
                        onPointerDown={(e) => handleTextDragStart(e, ann)}
                        className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md cursor-move transition-colors"
                        aria-label="Move text" title="Move text"
                      >
                        <Move className="w-4 h-4" />
                      </button>
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); startEditingText(ann); }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                        aria-label="Edit text" title="Edit text"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); deleteAnnotation(getOriginalPageNum(), ann.id); }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                        aria-label="Delete" title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              }
              if (ann.type === 'image') {
                return (
                  <div 
                    key={ann.id} 
                    className="absolute group cursor-move"
                    onPointerDown={(e) => handleTextDragStart(e, ann)}
                    style={{ 
                      left: `${ann.x * PDF_SCALE}px`, 
                      top: `${ann.y * PDF_SCALE}px`,
                      width: `${ann.w * PDF_SCALE}px`,
                      height: `${ann.h * PDF_SCALE}px`
                    }}
                  >
                    <img src={ann.dataUrl} alt="Signature" className="w-full h-full object-contain pointer-events-none" />
                    <div 
                      className={`absolute -top-10 left-0 flex gap-1 ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity z-10 bg-white shadow-md rounded-lg p-1 border border-slate-200 cursor-default`}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); deleteAnnotation(getOriginalPageNum(), ann.id); }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                        aria-label="Delete" title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Resize Handle */}
                    <div 
                      onPointerDown={(e) => handleImageResizeStart(e, ann)}
                      className={`absolute -bottom-2 -right-2 w-5 h-5 bg-white border-2 border-red-600 rounded-full cursor-nwse-resize ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} shadow-md transition-opacity z-20`}
                      aria-label="Resize" title="Resize"
                    />
                  </div>
                );
              }
              if (ann.type === 'symbol') {
                return (
                  <div 
                    key={ann.id}
                    className="absolute group flex items-center justify-center cursor-move"
                    onPointerDown={(e) => handleTextDragStart(e, ann)}
                    style={{ 
                      left: `${ann.x * PDF_SCALE}px`, 
                      top: `${ann.y * PDF_SCALE}px`,
                      transform: `scale(${ann.scale || 1})`,
                      transformOrigin: 'top left'
                    }}
                  >
                    {ann.symbol === 'check' ? (
                      <Check className="w-8 h-8 text-black" strokeWidth={3} />
                    ) : (
                      <X className="w-8 h-8 text-black" strokeWidth={3} />
                    )}
                    <div 
                      className={`absolute -top-10 left-1/2 -translate-x-1/2 flex gap-1 ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity z-10 bg-white shadow-md rounded-lg p-1 border border-slate-200 cursor-default`}
                      style={{ transform: `translateX(-50%) scale(${1 / (ann.scale || 1)})` }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); deleteAnnotation(getOriginalPageNum(), ann.id); }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                        aria-label="Delete" title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Resize Handle */}
                    <div 
                      onPointerDown={(e) => handleImageResizeStart(e, ann)}
                      className={`absolute -bottom-2 -right-2 w-4 h-4 md:w-5 md:h-5 bg-white border-2 border-red-600 rounded-full cursor-nwse-resize ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} shadow-md transition-opacity z-20`}
                      style={{ transform: `scale(${1 / (ann.scale || 1)})` }}
                      aria-label="Resize" title="Resize"
                    />
                  </div>
                );
              }
              if (ann.type === 'stamp') {
                return (
                  <div 
                    key={ann.id}
                    className="absolute group cursor-move"
                    onPointerDown={(e) => handleTextDragStart(e, ann)}
                    style={{ 
                      left: `${ann.x * PDF_SCALE}px`, 
                      top: `${ann.y * PDF_SCALE}px`,
                      transform: `scale(${ann.scale || 1})`,
                      transformOrigin: 'top left'
                    }}
                  >
                    <div 
                      className="px-2 py-1 md:px-4 md:py-1 border-4 rounded-md font-bold text-xl md:text-2xl uppercase bg-white/80 backdrop-blur-sm shadow-sm"
                      style={{ 
                        color: ann.color, 
                        borderColor: ann.color,
                      }}
                    >
                      {ann.text}
                    </div>
                    <div 
                      className={`absolute -top-10 left-1/2 -translate-x-1/2 flex gap-1 ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity z-10 bg-white shadow-md rounded-lg p-1 border border-slate-200 cursor-default`}
                      style={{ transform: `translateX(-50%) scale(${1 / (ann.scale || 1)})` }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button 
                        onPointerDown={(e) => { e.stopPropagation(); deleteAnnotation(getOriginalPageNum(), ann.id); }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                        aria-label="Delete" title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Resize Handle */}
                    <div 
                      onPointerDown={(e) => handleImageResizeStart(e, ann)}
                      className={`absolute -bottom-3 -right-3 w-4 h-4 md:w-5 md:h-5 bg-white border-2 border-red-600 rounded-full cursor-nwse-resize ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} shadow-md transition-opacity z-20`}
                      style={{ transform: `scale(${1 / (ann.scale || 1)})` }}
                      aria-label="Resize" title="Resize"
                    />
                  </div>
                );
              }
              if (ann.type === 'draw') {
                const isSelected = selectedDrawId === ann.id;
                const minX = Math.min(...ann.points.map(p => p.x));
                const minY = Math.min(...ann.points.map(p => p.y));
                const w = Math.max(...ann.points.map(p => p.x)) - minX;
                const h = Math.max(...ann.points.map(p => p.y)) - minY;

                return (
                  <div key={ann.id} className="absolute inset-0 pointer-events-none" style={{ zIndex: isSelected ? 20 : 10 }}>
                    <svg className="w-full h-full">
                      <polyline 
                        points={ann.points.map(p => `${p.x * PDF_SCALE},${p.y * PDF_SCALE}`).join(' ')} 
                        fill="none" 
                        stroke={isSelected ? '#4f46e5' : (hoveredDrawId === ann.id ? '#ef4444' : 'black')} 
                        strokeWidth={2 * PDF_SCALE}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ pointerEvents: 'visibleStroke', cursor: 'pointer' }}
                        onPointerEnter={() => setHoveredDrawId(ann.id)}
                        onPointerLeave={() => setHoveredDrawId(null)}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedDrawId(ann.id);
                        }}
                      />
                    </svg>
                    
                    {isSelected && (
                      <div 
                        className="absolute border-2 border-red-500/50 pointer-events-none rounded-lg"
                        style={{
                          left: `${minX * PDF_SCALE - 8}px`,
                          top: `${minY * PDF_SCALE - 8}px`,
                          width: `${w * PDF_SCALE + 16}px`,
                          height: `${h * PDF_SCALE + 16}px`
                        }}
                      >
                        <button 
                          onPointerDown={(e) => { 
                            e.stopPropagation(); 
                            deleteAnnotation(getOriginalPageNum(), ann.id); 
                            setSelectedDrawId(null); 
                          }}
                          className="absolute -top-4 -right-4 p-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-slate-500 rounded-full shadow-md pointer-events-auto transition-colors"
                          aria-label="Delete drawing" title="Delete drawing"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              if (ann.type === 'blackout' || ann.type === 'whiteout' || ann.type === 'highlight') {
                const isWhiteout = ann.type === 'whiteout';
                const isHighlight = ann.type === 'highlight';
                return (
                  <div 
                    key={ann.id}
                    className={`absolute group ${isWhiteout ? 'bg-white border border-dashed border-slate-300' : isHighlight ? '' : 'bg-black'}`}
                    style={{
                      left: `${ann.x * PDF_SCALE}px`,
                      top: `${ann.y * PDF_SCALE}px`,
                      width: `${ann.w * PDF_SCALE}px`,
                      height: `${ann.h * PDF_SCALE}px`,
                      backgroundColor: isHighlight ? ann.color : undefined,
                      mixBlendMode: isHighlight ? 'multiply' : 'normal',
                      opacity: isHighlight ? 0.4 : 1,
                    }}
                  >
                     <button 
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(getOriginalPageNum(), ann.id); }}
                      className={`absolute -top-3 -right-3 p-1 bg-red-100 text-red-600 rounded-full ${activeAnnId === ann.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity shadow-sm z-10`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              }
              return null;
            })}

            {/* Render Current Drawing Path */}
            {isDrawing && currentPath && (
              <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                <polyline 
                  points={currentPath.points.map(p => `${p.x * PDF_SCALE},${p.y * PDF_SCALE}`).join(' ')} 
                  fill="none" 
                  stroke="black" 
                  strokeWidth={2 * PDF_SCALE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {/* Render Current Blackout/Whiteout Rect */}
            {isDrawing && currentBlackout && (
               <div 
                  className={`absolute border border-dashed pointer-events-none ${currentBlackout.type === 'whiteout' ? 'bg-white/90 border-slate-400' : currentBlackout.type === 'highlight' ? 'border-slate-400' : 'bg-black/80 border-white'}`}
                  style={{
                    left: `${currentBlackout.rect.x * PDF_SCALE}px`,
                    top: `${currentBlackout.rect.y * PDF_SCALE}px`,
                    width: `${currentBlackout.rect.w * PDF_SCALE}px`,
                    height: `${currentBlackout.rect.h * PDF_SCALE}px`,
                    backgroundColor: currentBlackout.type === 'highlight' ? currentBlackout.color : undefined,
                    mixBlendMode: currentBlackout.type === 'highlight' ? 'multiply' : 'normal',
                    opacity: currentBlackout.type === 'highlight' ? 0.4 : 1,
                  }}
               />
            )}

            {/* Text Input Box */}
            {textInput && (
              <div
                className="absolute z-20"
                style={{
                  left: `${textInput.x * PDF_SCALE}px`,
                  top: `${textInput.y * PDF_SCALE}px`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={textInputRef}
                  type="text"
                  value={textInput.text}
                  onChange={(e) => setTextInput({...textInput, text: e.target.value})}
                  onKeyDown={handleTextKeyDown}
                  className={`bg-white border-2 border-red-500 shadow-lg outline-none px-2 py-1 text-black font-sans rounded-none ${textInput.isBold ? 'font-bold' : ''} ${textInput.isItalic ? 'italic' : ''}`}
                  style={{
                    fontSize: `${(textInput.size || textSize) * PDF_SCALE}px`,
                    minWidth: '200px',
                    lineHeight: 1,
                  }}
                  placeholder="Type here, press Enter ↵"
                />
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
      ) : (
        <OrganizeView 
          pdfDoc={pdfDoc}
          pageOrder={pageOrder}
          setPageOrder={setPageOrder}
          onSelectPage={(displayNum) => {
            setPageNum(displayNum);
            setViewMode('edit');
          }}
        />
      )}
      
      {/* Signature Modal */}
      <SignatureModal 
        isOpen={isSignatureModalOpen} 
        onClose={() => setIsSignatureModalOpen(false)} 
        onSave={(dataUrl) => {
          setActiveSignature(dataUrl);
          stampSignature(dataUrl);
        }}
      />
    </div>
  );
}
