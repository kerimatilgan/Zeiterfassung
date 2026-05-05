import { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

interface SortableCardProps {
  id: string;
  className?: string;
  // Ermöglicht Reordering ohne JSX-Umsortierung — die Karten bleiben in fester
  // DOM-Reihenfolge, CSS `order` setzt die visuelle Position.
  order?: number;
  children: ReactNode;
}

// Wrapper für eine im Dashboard sortierbare Karte. Drag wird ausschließlich über
// das Handle (oben rechts) gestartet — sonst kollidiert es auf Touch-Geräten
// mit Klicks und Scrollen innerhalb der Karte.
export default function SortableCard({ id, className = '', order, children }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Beim Drag wird die Original-Karte als "Geisterbild" angezeigt (Drag-Overlay
    // zeigt parallel die schwebende Vorschau am Cursor). Das macht die Drop-Zone
    // visuell verständlich, ohne einen leeren Slot zu hinterlassen.
    opacity: isDragging ? 0.3 : undefined,
    order,
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative ${className}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Karte verschieben"
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={16} />
      </button>
      {children}
    </div>
  );
}
