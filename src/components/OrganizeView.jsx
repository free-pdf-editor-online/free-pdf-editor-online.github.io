import React, { useEffect, useState, useRef } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Trash2, GripVertical } from 'lucide-react';

function SortableItem({ id, pageNum, pdfDoc, onDelete, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    const renderThumb = async () => {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (!isActive) return;
        
        // Use a small scale for thumbnail
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        renderTaskRef.current = page.render({ canvasContext: context, viewport });
        await renderTaskRef.current.promise;
      } catch (e) {
        if (e.name !== 'RenderingCancelledException') {
          console.error(e);
        }
      }
    };
    renderThumb();
    return () => {
      isActive = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, pageNum]);

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className="relative bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center group cursor-pointer hover:border-red-400 transition-colors"
      onClick={onClick}
    >
      <div 
        className="w-full h-full flex justify-center items-center bg-slate-50 rounded-lg overflow-hidden relative"
        style={{ minHeight: '150px' }}
      >
        <canvas ref={canvasRef} className="max-w-full max-h-full object-contain pointer-events-none" />
      </div>
      <div className="mt-2 text-sm font-medium text-slate-600 flex items-center justify-between w-full px-1">
        <span className="flex items-center gap-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
          <GripVertical className="w-4 h-4" />
        </span>
        <span>Page {pageNum}</span>
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(id); }}
          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          title="Delete Page"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function OrganizeView({ pdfDoc, pageOrder, setPageOrder, onSelectPage }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPageOrder((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleDelete = (id) => {
    if (pageOrder.length <= 1) {
      alert("You cannot delete the last page.");
      return;
    }
    setPageOrder(pageOrder.filter(p => p.id !== id));
  };

  return (
    <div className="w-full bg-slate-100/50 rounded-2xl border border-slate-200 p-6 overflow-auto min-h-[600px]">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Organize Pages</h2>
          <p className="text-sm text-slate-500">Drag to reorder, click trash to delete, click a page to edit.</p>
        </div>
      </div>
      
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          <SortableContext items={pageOrder.map(p => p.id)} strategy={rectSortingStrategy}>
            {pageOrder.map((pageObj, index) => (
              <SortableItem 
                key={pageObj.id} 
                id={pageObj.id} 
                pageNum={pageObj.originalNum} 
                pdfDoc={pdfDoc}
                onDelete={handleDelete}
                onClick={() => onSelectPage(index + 1)} // 1-indexed display page
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </div>
  );
}
